use flate2::read::GzDecoder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::DefaultHasher, BTreeSet, HashMap, VecDeque},
    env,
    ffi::OsString,
    fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Response, AppHandle, Emitter, Manager};
use wait_timeout::ChildExt;

const MAX_TEXT_FILE_SIZE: u64 = 8 * 1024 * 1024;
const MAX_PROJECT_FILE_SIZE: u64 = 100 * 1024 * 1024;
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const TINYTEX_RELEASE_TAG: &str = "v2026.08";
const TINYTEX_RELEASE_API: &str =
    "https://api.github.com/repos/rstudio/tinytex-releases/releases/tags/v2026.08";
const TEXLIVE_PACKAGE_REPOSITORY: &str = "https://mirror.ctan.org/systems/texlive/tlnet";
const CONFERENCE_TEX_CACHE_VERSION: &str = "2026-08-05-v1";
const CONFERENCE_PACKAGE_SET_VERSION: &str = "2026-08-05-v1";
static RUNTIME_INSTALLING: AtomicBool = AtomicBool::new(false);

static CONFERENCE_TEX_PACKAGES: &[&str] = &[
    "algorithmicx",
    "algorithms",
    "caption",
    "carlisle",
    "cleveref",
    "enumitem",
    "environ",
    "eso-pic",
    "fancyhdr",
    "fontaxes",
    "forloop",
    "grfext",
    "lineno",
    "listings",
    "multirow",
    "mweights",
    "newfloat",
    "newtx",
    "placeins",
    "silence",
    "trimspaces",
    "xpatch",
    "xstring",
];

static CONFERENCE_TEX_SENTINELS: &[&str] = &[
    "algpseudocode.sty",
    "algorithm.sty",
    "caption.sty",
    "cleveref.sty",
    "enumitem.sty",
    "environ.sty",
    "eso-pic.sty",
    "fancyhdr.sty",
    "fontaxes.sty",
    "forloop.sty",
    "grfext.sty",
    "lineno.sty",
    "listings.sty",
    "multirow.sty",
    "mweights.sty",
    "newfloat.sty",
    "newtxtext.sty",
    "placeins.sty",
    "scalefnt.sty",
    "silence.sty",
    "trimspaces.sty",
    "xpatch.sty",
    "xstring.sty",
];

struct EmbeddedTexResource {
    relative_path: &'static str,
    bytes: &'static [u8],
}

static CONFERENCE_TEX_RESOURCES: &[EmbeddedTexResource] = &[
    EmbeddedTexResource {
        relative_path: "aaai/2027/aaai2027.sty",
        bytes: include_bytes!("../resources/conference-tex/aaai/2027/aaai2027.sty"),
    },
    EmbeddedTexResource {
        relative_path: "aaai/2027/aaai2027.bst",
        bytes: include_bytes!("../resources/conference-tex/aaai/2027/aaai2027.bst"),
    },
    EmbeddedTexResource {
        relative_path: "neurips/2026/neurips_2026.sty",
        bytes: include_bytes!("../resources/conference-tex/neurips/2026/neurips_2026.sty"),
    },
    EmbeddedTexResource {
        relative_path: "icml/2026/icml2026.sty",
        bytes: include_bytes!("../resources/conference-tex/icml/2026/icml2026.sty"),
    },
    EmbeddedTexResource {
        relative_path: "icml/2026/icml2026.bst",
        bytes: include_bytes!("../resources/conference-tex/icml/2026/icml2026.bst"),
    },
    EmbeddedTexResource {
        relative_path: "iclr/2026/iclr2026_conference.sty",
        bytes: include_bytes!("../resources/conference-tex/iclr/2026/iclr2026_conference.sty"),
    },
    EmbeddedTexResource {
        relative_path: "iclr/2026/iclr2026_conference.bst",
        bytes: include_bytes!("../resources/conference-tex/iclr/2026/iclr2026_conference.bst"),
    },
    EmbeddedTexResource {
        relative_path: "acl/current/acl.sty",
        bytes: include_bytes!("../resources/conference-tex/acl/current/acl.sty"),
    },
    EmbeddedTexResource {
        relative_path: "acl/current/acl_natbib.bst",
        bytes: include_bytes!("../resources/conference-tex/acl/current/acl_natbib.bst"),
    },
    EmbeddedTexResource {
        relative_path: "cvpr/2026/cvpr.sty",
        bytes: include_bytes!("../resources/conference-tex/cvpr/2026/cvpr.sty"),
    },
    EmbeddedTexResource {
        relative_path: "cvpr/2026/ieeenat_fullname.bst",
        bytes: include_bytes!("../resources/conference-tex/cvpr/2026/ieeenat_fullname.bst"),
    },
];

struct RuntimeInstallGuard;

impl RuntimeInstallGuard {
    fn acquire() -> Result<Self, String> {
        RUNTIME_INSTALLING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "TeX 环境正在安装，请等待当前任务完成。".to_string())
    }
}

impl Drop for RuntimeInstallGuard {
    fn drop(&mut self) {
        RUNTIME_INSTALLING.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexRuntimeStatus {
    available: bool,
    distribution: Option<String>,
    version: Option<String>,
    latexmk_path: Option<String>,
    engines: Vec<String>,
    biber_available: bool,
    managed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstallProgress {
    phase: String,
    message: String,
    percent: u8,
    downloaded_bytes: u64,
    total_bytes: u64,
}

#[derive(Deserialize)]
struct GithubRelease {
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Deserialize)]
struct GithubReleaseAsset {
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterFileEntry {
    path: String,
    name: String,
    kind: String,
    size: u64,
    editable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterProject {
    id: String,
    name: String,
    root_path: String,
    main_file: Option<String>,
    files: Vec<WriterFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterFileLocation {
    root_path: String,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRequest {
    root_path: String,
    main_file: String,
    engine: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    file: Option<String>,
    line: Option<u32>,
    severity: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    status: String,
    duration_ms: u128,
    log: String,
    diagnostics: Vec<CompileDiagnostic>,
    pdf_available: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTexEditRequest {
    root_path: String,
    page: u32,
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTexViewRequest {
    root_path: String,
    file_path: String,
    line: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterSourcePosition {
    file_path: String,
    line: u32,
    column: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterPdfPosition {
    page: u32,
    x: f64,
    y: f64,
}

fn managed_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法确定运行时目录：{error}"))?
        .join("toolchains/TinyTeX"))
}

fn managed_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    let bin_root = managed_runtime_root(app).ok()?.join("bin");
    fs::read_dir(bin_root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.join(executable_name("latexmk")).is_file())
}

fn candidate_bin_dirs(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    #[cfg(target_os = "macos")]
    dirs.extend([
        PathBuf::from("/Library/TeX/texbin"),
        PathBuf::from("/usr/local/texlive/2026/bin/universal-darwin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ]);
    #[cfg(target_os = "linux")]
    dirs.extend([PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")]);
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local_app_data).join("Programs/MiKTeX/miktex/bin/x64"));
    }
    dirs.sort();
    dirs.dedup();
    if let Some(managed) = app.and_then(managed_bin_dir) {
        dirs.retain(|path| path != &managed);
        dirs.insert(0, managed);
    }
    dirs
}

fn executable_name(name: &str) -> OsString {
    #[cfg(target_os = "windows")]
    {
        return format!("{name}.exe").into();
    }
    #[cfg(not(target_os = "windows"))]
    {
        name.into()
    }
}

fn find_executable(name: &str, app: Option<&AppHandle>) -> Option<PathBuf> {
    let executable = executable_name(name);
    candidate_bin_dirs(app)
        .into_iter()
        .map(|dir| dir.join(&executable))
        .find(|path| path.is_file())
}

fn runtime_status(app: Option<&AppHandle>) -> LatexRuntimeStatus {
    let managed_root = app.and_then(|handle| managed_runtime_root(handle).ok());
    let latexmk = find_executable("latexmk", app);
    let engines = ["pdflatex", "xelatex", "lualatex"]
        .into_iter()
        .filter(|name| find_executable(name, app).is_some())
        .map(String::from)
        .collect::<Vec<_>>();
    let version = latexmk.as_ref().and_then(|path| {
        Command::new(path)
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                String::from_utf8(output.stdout).ok().and_then(|value| {
                    value
                        .lines()
                        .find(|line| !line.trim().is_empty())
                        .map(str::to_owned)
                })
            })
    });
    let managed = latexmk.as_ref().is_some_and(|path| {
        managed_root
            .as_ref()
            .is_some_and(|root| path.starts_with(root))
    });
    let distribution = latexmk.as_ref().map(|path| {
        let value = path.to_string_lossy().to_lowercase();
        if managed {
            format!("WhalePaper TinyTeX {TINYTEX_RELEASE_TAG}")
        } else if value.contains("miktex") {
            "MiKTeX".to_string()
        } else if cfg!(target_os = "macos") && value.contains("tex") {
            "MacTeX / TeX Live".to_string()
        } else {
            "TeX Live".to_string()
        }
    });
    LatexRuntimeStatus {
        available: latexmk.is_some() && !engines.is_empty(),
        distribution,
        version,
        latexmk_path: latexmk.map(|path| path.to_string_lossy().into_owned()),
        engines,
        biber_available: find_executable("biber", app).is_some(),
        managed,
    }
}

fn command_with_runtime_path(executable: &Path, bin_dir: &Path) -> Command {
    let mut command = Command::new(executable);
    let mut paths = vec![bin_dir.to_path_buf()];
    paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
    if let Ok(path) = env::join_paths(paths) {
        command.env("PATH", path);
    }
    command
}

fn ensure_managed_conference_packages(
    app: &AppHandle,
    runtime: &LatexRuntimeStatus,
) -> Result<(), String> {
    if !runtime.managed {
        return Ok(());
    }
    let runtime_root = managed_runtime_root(app)?;
    let marker = runtime_root.join(format!(
        ".whalepaper-conference-packages-{CONFERENCE_PACKAGE_SET_VERSION}"
    ));
    if marker.is_file() {
        return Ok(());
    }
    let bin_dir = managed_bin_dir(app)
        .ok_or_else(|| "WhalePaper 托管的 TeX 环境不完整，请重新安装。".to_string())?;
    let kpsewhich = bin_dir.join(executable_name("kpsewhich"));
    let missing = CONFERENCE_TEX_SENTINELS
        .iter()
        .filter(|file_name| {
            !command_with_runtime_path(&kpsewhich, &bin_dir)
                .arg(file_name)
                .output()
                .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
        })
        .copied()
        .collect::<Vec<_>>();

    if !missing.is_empty() {
        emit_install_progress(app, "installing", "正在安装会议模板依赖", 92, 0, 0);
        let tlmgr = bin_dir.join(executable_name("tlmgr"));
        let mut install = command_with_runtime_path(&tlmgr, &bin_dir);
        install
            .args(["--repository", TEXLIVE_PACKAGE_REPOSITORY])
            .arg("install")
            .args(CONFERENCE_TEX_PACKAGES)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = install
            .spawn()
            .map_err(|error| format!("无法启动 TeX 包管理器：{error}"))?;
        match child
            .wait_timeout(Duration::from_secs(180))
            .map_err(|error| format!("无法等待 TeX 包管理器：{error}"))?
        {
            Some(status) if status.success() => {}
            Some(_) => return Err("会议模板依赖安装失败，请检查网络后重试。".into()),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("会议模板依赖安装超时，请检查网络后重试。".into());
            }
        }
    }

    let unresolved = CONFERENCE_TEX_SENTINELS
        .iter()
        .filter(|file_name| {
            !command_with_runtime_path(&kpsewhich, &bin_dir)
                .arg(file_name)
                .output()
                .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    if !unresolved.is_empty() {
        return Err(format!(
            "TeX 环境仍缺少会议模板依赖：{}。请重新安装托管环境。",
            unresolved.join("、")
        ));
    }
    fs::write(&marker, CONFERENCE_PACKAGE_SET_VERSION)
        .map_err(|error| format!("无法保存 TeX 依赖状态：{error}"))?;
    Ok(())
}

fn emit_install_progress(
    app: &AppHandle,
    phase: &str,
    message: &str,
    percent: u8,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    let _ = app.emit(
        "writer-runtime-progress",
        RuntimeInstallProgress {
            phase: phase.into(),
            message: message.into(),
            percent,
            downloaded_bytes,
            total_bytes,
        },
    );
}

fn runtime_asset_name() -> Result<&'static str, String> {
    #[cfg(target_os = "macos")]
    return Ok("TinyTeX-1-darwin-v2026.08.tar.xz");

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok("TinyTeX-1-linux-arm64-v2026.08.tar.xz");

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok("TinyTeX-1-linux-x86_64-v2026.08.tar.xz");

    #[cfg(target_os = "windows")]
    return Ok("TinyTeX-1-windows-v2026.08.exe");

    #[allow(unreachable_code)]
    Err("当前系统暂不支持自动安装 TeX 环境。".into())
}

fn install_extracted_runtime(app: &AppHandle, archive_path: &Path) -> Result<(), String> {
    let root = managed_runtime_root(app)?;
    let toolchains = root
        .parent()
        .ok_or_else(|| "运行时目录无效。".to_string())?;
    let staging = toolchains.join(".tinytex-installing");
    let backup = toolchains.join(".tinytex-backup");
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&backup);
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建安装目录：{error}"))?;

    #[cfg(not(target_os = "windows"))]
    {
        let archive_file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
        let decoder = xz2::read::XzDecoder::new(archive_file);
        tar::Archive::new(decoder)
            .unpack(&staging)
            .map_err(|error| format!("无法解压 TeX 环境：{error}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new(archive_path)
            .arg("-y")
            .arg(format!("-o{}", staging.to_string_lossy()))
            .status()
            .map_err(|error| format!("无法启动 TeX 安装包：{error}"))?;
        if !status.success() {
            return Err("TeX 安装包解压失败。".into());
        }
    }

    let extracted = staging.join("TinyTeX");
    if !extracted.is_dir() {
        return Err("安装包中缺少 TinyTeX 运行时。".into());
    }
    if root.exists() {
        fs::rename(&root, &backup).map_err(|error| format!("无法备份原运行时：{error}"))?;
    }
    if let Err(error) = fs::rename(&extracted, &root) {
        if backup.exists() {
            let _ = fs::rename(&backup, &root);
        }
        return Err(format!("无法启用新运行时：{error}"));
    }
    let _ = fs::remove_dir_all(&backup);
    let _ = fs::remove_dir_all(&staging);
    if managed_bin_dir(app).is_none() {
        return Err("安装完成，但没有找到 latexmk。".into());
    }
    Ok(())
}

pub(crate) fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root_path).map_err(|error| format!("无法打开项目目录：{error}"))?;
    if !root.is_dir() {
        return Err("写作项目必须是一个目录。".into());
    }
    Ok(root)
}

pub(crate) fn checked_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("项目文件路径无效。".into());
    }
    let path = root.join(relative);
    let canonical =
        fs::canonicalize(&path).map_err(|error| format!("无法访问项目文件：{error}"))?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("项目文件超出了当前项目目录。".into());
    }
    Ok(canonical)
}

/// Resolve a project path that may not exist yet, while still validating the
/// existing parent chain against the project root. This is used by restore
/// operations, where a historical file must be recreated after deletion.
pub(crate) fn checked_relative_path_for_write(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("项目文件路径无效。".into());
    }
    let path = root.join(relative);
    if path.exists() {
        let canonical =
            fs::canonicalize(&path).map_err(|error| format!("无法访问项目文件：{error}"))?;
        if !canonical.starts_with(root) || !canonical.is_file() {
            return Err("项目文件超出了当前项目目录。".into());
        }
        return Ok(canonical);
    }
    let mut parent = path
        .parent()
        .ok_or_else(|| "项目文件路径无效。".to_string())?;
    while !parent.exists() {
        parent = parent
            .parent()
            .ok_or_else(|| "项目文件路径无效。".to_string())?;
    }
    let canonical_parent =
        fs::canonicalize(parent).map_err(|error| format!("无法访问项目文件目录：{error}"))?;
    if !canonical_parent.starts_with(root) || !canonical_parent.is_dir() {
        return Err("项目文件超出了当前项目目录。".into());
    }
    Ok(path)
}

fn is_editable(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "tex" | "bib" | "cls" | "sty" | "bst" | "md" | "txt"
    )
}

fn is_tex_source(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "tex" | "sty" | "cls"))
}

fn should_skip_directory(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "build" | "dist" | "target")
}

fn directory_has_root_tex(directory: &Path) -> bool {
    fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("tex"))
        })
        .any(|path| {
            path.metadata()
                .is_ok_and(|metadata| metadata.len() <= MAX_TEXT_FILE_SIZE)
                && fs::read_to_string(path).is_ok_and(|content| content.contains("\\documentclass"))
        })
}

fn find_main_documents(
    root: &Path,
    directory: &Path,
    documents: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| format!("无法读取项目目录：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取项目文件：{error}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            if should_skip_directory(&name) {
                continue;
            }
            find_main_documents(root, &path, documents)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("tex"))
            && path
                .metadata()
                .is_ok_and(|metadata| metadata.len() <= MAX_TEXT_FILE_SIZE)
            && fs::read_to_string(&path).is_ok_and(|content| content.contains("\\documentclass"))
        {
            documents.push(
                path.strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_path_buf(),
            );
        }
    }
    Ok(())
}

fn strip_tex_comments(content: &str) -> String {
    let mut stripped = String::with_capacity(content.len());
    for line in content.lines() {
        let mut escaped = false;
        for character in line.chars() {
            if character == '%' && !escaped {
                break;
            }
            stripped.push(character);
            if character == '\\' {
                escaped = !escaped;
            } else {
                escaped = false;
            }
        }
        stripped.push('\n');
    }
    stripped
}

fn is_auxiliary_main_document(path: &Path) -> bool {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "");
    [
        "checklist",
        "reproducibility",
        "supplement",
        "supplementary",
        "appendix",
        "rebuttal",
        "response",
        "coverletter",
        "instructions",
    ]
    .iter()
    .any(|keyword| name.contains(keyword))
}

fn main_document_score(root: &Path, path: &Path) -> i64 {
    let Ok(content) = fs::read_to_string(root.join(path)) else {
        return i64::MIN;
    };
    let content = strip_tex_comments(&content);
    let compact = content.split_whitespace().collect::<String>();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let mut score = 0_i64;

    if file_name.eq_ignore_ascii_case("main.tex") {
        score += 1_000;
    }
    if is_auxiliary_main_document(path) {
        score -= 1_000;
    }
    if compact.contains("\\title{") {
        score += 180;
    }
    if compact.contains("\\author{") {
        score += 100;
    }
    if compact.contains("\\maketitle") {
        score += 180;
    }
    if compact.contains("\\begin{abstract}") {
        score += 180;
    }
    if compact.contains("\\bibliography{") || compact.contains("\\addbibresource{") {
        score += 80;
    }
    score += (compact.matches("\\section{").count().min(8) as i64) * 15;
    score += (compact.matches("\\input{").count().min(8) as i64) * 12;
    score += ((content.len() / 4096).min(40)) as i64;

    // Standalone wrappers are commonly auxiliary files that can also be input by the paper.
    if compact.contains("\\@ifundefined{") && compact.to_ascii_lowercase().contains("standalone") {
        score -= 120;
    }
    score
}

fn resolve_project_dependency(
    root: &Path,
    source: &Path,
    value: &str,
    extensions: &[&str],
) -> Option<PathBuf> {
    let value = value.trim().trim_matches('"');
    if value.is_empty() || value.contains(['\\', '#', '$']) || Path::new(value).is_absolute() {
        return None;
    }
    let raw = Path::new(value);
    let mut names = vec![raw.to_path_buf()];
    if raw.extension().is_none() {
        names.extend(
            extensions
                .iter()
                .map(|extension| raw.with_extension(extension)),
        );
    }
    let source_directory = source.parent().unwrap_or(root);
    for base in [root, source_directory] {
        for name in &names {
            let candidate = base.join(name);
            let Ok(canonical) = fs::canonicalize(candidate) else {
                continue;
            };
            if canonical.is_file() && canonical.starts_with(root) {
                return canonical.strip_prefix(root).ok().map(Path::to_path_buf);
            }
        }
    }
    None
}

fn enqueue_dependency(
    root: &Path,
    source: &Path,
    value: &str,
    extensions: &[&str],
    related: &mut BTreeSet<PathBuf>,
    pending: &mut VecDeque<PathBuf>,
) {
    if let Some(path) = resolve_project_dependency(root, source, value, extensions) {
        if related.insert(path.clone()) && is_tex_source(&path) {
            pending.push_back(path);
        }
    }
}

fn discover_project_files(
    root: &Path,
    entry_file: Option<&str>,
) -> Result<(Option<String>, BTreeSet<PathBuf>), String> {
    let mut documents = Vec::new();
    find_main_documents(root, root, &mut documents)?;
    documents.sort();

    let entry = entry_file
        .filter(|value| !value.is_empty())
        .and_then(|value| checked_relative_path(root, value).ok())
        .and_then(|path| path.strip_prefix(root).ok().map(Path::to_path_buf));
    let entry_is_main = entry.as_ref().is_some_and(|path| {
        fs::read_to_string(root.join(path)).is_ok_and(|content| content.contains("\\documentclass"))
    });
    let shallowest_depth = documents.iter().map(|path| path.components().count()).min();
    let main_documents = documents
        .iter()
        .filter(|path| Some(path.components().count()) == shallowest_depth)
        .cloned()
        .collect::<Vec<_>>();
    let scored_main = main_documents
        .iter()
        .max_by(|left, right| {
            main_document_score(root, left)
                .cmp(&main_document_score(root, right))
                .then_with(|| right.cmp(left))
        })
        .cloned();
    let entry_is_auxiliary = entry
        .as_ref()
        .is_some_and(|path| is_auxiliary_main_document(path));
    let scored_main_is_regular = scored_main
        .as_ref()
        .is_some_and(|path| !is_auxiliary_main_document(path));
    let preferred_main = if entry_is_main && !(entry_is_auxiliary && scored_main_is_regular) {
        entry.clone()
    } else {
        scored_main
    };

    let mut related = BTreeSet::new();
    let mut pending = VecDeque::new();
    for path in main_documents.into_iter().chain(entry) {
        if related.insert(path.clone()) {
            pending.push_back(path);
        }
    }

    let input =
        Regex::new(r"\\(?:input|include|subfile)\s*\{([^{}]+)\}").expect("valid input regex");
    let graphics = Regex::new(r"\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}")
        .expect("valid graphics regex");
    let bibliography =
        Regex::new(r"\\bibliography\s*\{([^{}]+)\}").expect("valid bibliography regex");
    let bib_resource = Regex::new(r"\\addbibresource(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}")
        .expect("valid bib resource regex");
    let package =
        Regex::new(r"\\usepackage(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}").expect("valid package regex");
    let document_class = Regex::new(r"\\documentclass(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}")
        .expect("valid document class regex");
    let bibliography_style =
        Regex::new(r"\\bibliographystyle\s*\{([^{}]+)\}").expect("valid bibliography style regex");
    let listing = Regex::new(r"\\lstinputlisting(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}")
        .expect("valid listing regex");

    while let Some(relative) = pending.pop_front() {
        let source = root.join(&relative);
        let Ok(content) = fs::read_to_string(&source) else {
            continue;
        };
        let content = strip_tex_comments(&content);
        for capture in input.captures_iter(&content) {
            enqueue_dependency(
                root,
                &source,
                &capture[1],
                &["tex"],
                &mut related,
                &mut pending,
            );
        }
        for capture in graphics.captures_iter(&content) {
            enqueue_dependency(
                root,
                &source,
                &capture[1],
                &["pdf", "png", "jpg", "jpeg", "eps", "svg"],
                &mut related,
                &mut pending,
            );
        }
        for capture in bibliography.captures_iter(&content) {
            for value in capture[1].split(',') {
                enqueue_dependency(root, &source, value, &["bib"], &mut related, &mut pending);
            }
        }
        for capture in bib_resource.captures_iter(&content) {
            enqueue_dependency(
                root,
                &source,
                &capture[1],
                &["bib"],
                &mut related,
                &mut pending,
            );
        }
        for capture in package.captures_iter(&content) {
            for value in capture[1].split(',') {
                enqueue_dependency(root, &source, value, &["sty"], &mut related, &mut pending);
            }
        }
        for capture in document_class.captures_iter(&content) {
            enqueue_dependency(
                root,
                &source,
                &capture[1],
                &["cls"],
                &mut related,
                &mut pending,
            );
        }
        for capture in bibliography_style.captures_iter(&content) {
            enqueue_dependency(
                root,
                &source,
                &capture[1],
                &["bst"],
                &mut related,
                &mut pending,
            );
        }
        for capture in listing.captures_iter(&content) {
            enqueue_dependency(root, &source, &capture[1], &[], &mut related, &mut pending);
        }
    }

    Ok((
        preferred_main.map(|path| path.to_string_lossy().replace('\\', "/")),
        related,
    ))
}

pub(crate) fn related_project_files(
    root: &Path,
    main_file: &str,
) -> Result<std::collections::BTreeMap<String, Vec<u8>>, String> {
    let (_, related) = discover_project_files(root, Some(main_file))?;
    related
        .into_iter()
        .map(|relative| {
            let key = relative.to_string_lossy().replace('\\', "/");
            let content = fs::read(root.join(&relative))
                .map_err(|error| format!("无法读取 {key}：{error}"))?;
            Ok((key, content))
        })
        .collect()
}

fn writer_file_entry(root: &Path, relative: &Path) -> Result<WriterFileEntry, String> {
    let path = root.join(relative);
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    Ok(WriterFileEntry {
        path: relative.to_string_lossy().replace('\\', "/"),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        kind: path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_ascii_lowercase(),
        size: metadata.len(),
        editable: is_editable(&path),
    })
}

fn project_hash(root: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn ensure_conference_style_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let style_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法确定内置会议模板目录：{error}"))?
        .join("writer-resources")
        .join("conference-tex")
        .join(CONFERENCE_TEX_CACHE_VERSION);

    for resource in CONFERENCE_TEX_RESOURCES {
        let destination = style_root.join(resource.relative_path);
        let current_matches = fs::read(&destination)
            .map(|bytes| bytes == resource.bytes)
            .unwrap_or(false);
        if current_matches {
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建内置会议模板目录：{error}"))?;
        }
        fs::write(&destination, resource.bytes)
            .map_err(|error| format!("无法写入内置会议模板：{error}"))?;
    }

    Ok(style_root)
}

fn tex_search_path(project_root: &Path, conference_style_root: &Path) -> OsString {
    let separator = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let mut value = OsString::new();
    value.push(project_root.as_os_str());
    value.push(separator);
    value.push(conference_style_root.as_os_str());
    value.push("//");
    value.push(separator);
    value
}

fn copy_project_files(
    source_root: &Path,
    source_dir: &Path,
    files: &BTreeSet<PathBuf>,
) -> Result<(), String> {
    for relative in files {
        let path = source_root.join(relative);
        let metadata = path.metadata().map_err(|error| error.to_string())?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file");
        if metadata.len() > MAX_PROJECT_FILE_SIZE {
            return Err(format!("项目文件过大，无法编译：{name}"));
        }
        let destination = source_dir.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&path, destination).map_err(|error| format!("无法复制 {name}：{error}"))?;
    }
    Ok(())
}

const SYNCTEX_UNITS_PER_PDF_POINT: f64 = 65_781.76;
const MAX_SYNCTEX_SIZE: u64 = 64 * 1024 * 1024;

fn parse_synctex_source_position(
    content: &str,
    source_dir: &Path,
    page: u32,
    x: f64,
    y: f64,
) -> Option<WriterSourcePosition> {
    let mut inputs = HashMap::<i32, PathBuf>::new();
    let mut magnification = 1000.0;
    let mut unit = 1.0;
    let mut x_offset = 0.0;
    let mut y_offset = 0.0;
    let mut current_page = None;
    let mut in_content = false;
    let mut best: Option<(f64, WriterSourcePosition)> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(value) = line.strip_prefix("Input:") {
            let mut parts = value.splitn(2, ':');
            if let (Some(tag), Some(path)) = (parts.next(), parts.next()) {
                if let Ok(tag) = tag.parse::<i32>() {
                    inputs.insert(tag, PathBuf::from(path));
                }
            }
            continue;
        }
        if !in_content {
            if let Some(value) = line.strip_prefix("Magnification:") {
                magnification = value.parse().unwrap_or(magnification);
            } else if let Some(value) = line.strip_prefix("Unit:") {
                unit = value.parse().unwrap_or(unit);
            } else if let Some(value) = line.strip_prefix("X Offset:") {
                x_offset = value.parse().unwrap_or(x_offset);
            } else if let Some(value) = line.strip_prefix("Y Offset:") {
                y_offset = value.parse().unwrap_or(y_offset);
            } else if line == "Content:" {
                in_content = true;
            }
            continue;
        }

        if let Some(value) = line.strip_prefix('{') {
            current_page = value.parse::<u32>().ok();
            continue;
        }
        if line.starts_with('}') {
            current_page = None;
            continue;
        }
        if current_page != Some(page) || line.len() < 2 {
            continue;
        }

        let Some(body) = line.get(1..) else { continue };
        let Some((source, coordinates)) = body.split_once(':') else {
            continue;
        };
        let mut source_parts = source.split(',');
        let (Some(tag), Some(source_line)) = (source_parts.next(), source_parts.next()) else {
            continue;
        };
        let (Ok(tag), Ok(source_line)) = (tag.parse::<i32>(), source_line.parse::<u32>()) else {
            continue;
        };
        let Some(input_path) = inputs.get(&tag) else {
            continue;
        };
        let Ok(relative) = input_path.strip_prefix(source_dir) else {
            continue;
        };
        if relative.extension().and_then(|value| value.to_str()) != Some("tex") {
            continue;
        }

        let position = coordinates.split(':').next().unwrap_or(coordinates);
        let mut position_parts = position.split(',');
        let (Some(node_x), Some(node_y)) = (position_parts.next(), position_parts.next()) else {
            continue;
        };
        let (Ok(node_x), Ok(node_y)) = (node_x.parse::<f64>(), node_y.parse::<f64>()) else {
            continue;
        };
        let scale = unit * magnification / 1000.0;
        if scale <= 0.0 {
            continue;
        }
        let target_x = (x * SYNCTEX_UNITS_PER_PDF_POINT - x_offset) / scale;
        let target_y = (y * SYNCTEX_UNITS_PER_PDF_POINT - y_offset) / scale;
        let score = (node_y - target_y).abs() * 2.0 + (node_x - target_x).abs();
        if best
            .as_ref()
            .is_none_or(|(best_score, _)| score < *best_score)
        {
            best = Some((
                score,
                WriterSourcePosition {
                    file_path: relative.to_string_lossy().replace('\\', "/"),
                    line: source_line.max(1),
                    column: 1,
                },
            ));
        }
    }

    best.map(|(_, position)| position)
}

fn parse_synctex_pdf_position(
    content: &str,
    source_dir: &Path,
    file_path: &str,
    line_number: u32,
) -> Option<WriterPdfPosition> {
    let mut inputs = HashMap::<i32, PathBuf>::new();
    let mut magnification = 1000.0;
    let mut unit = 1.0;
    let mut x_offset = 0.0;
    let mut y_offset = 0.0;
    let mut current_page = None;
    let mut in_content = false;
    let mut best: Option<(u32, WriterPdfPosition)> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(value) = line.strip_prefix("Input:") {
            let mut parts = value.splitn(2, ':');
            if let (Some(tag), Some(path)) = (parts.next(), parts.next()) {
                if let Ok(tag) = tag.parse::<i32>() {
                    inputs.insert(tag, PathBuf::from(path));
                }
            }
            continue;
        }
        if !in_content {
            if let Some(value) = line.strip_prefix("Magnification:") {
                magnification = value.parse().unwrap_or(magnification);
            } else if let Some(value) = line.strip_prefix("Unit:") {
                unit = value.parse().unwrap_or(unit);
            } else if let Some(value) = line.strip_prefix("X Offset:") {
                x_offset = value.parse().unwrap_or(x_offset);
            } else if let Some(value) = line.strip_prefix("Y Offset:") {
                y_offset = value.parse().unwrap_or(y_offset);
            } else if line == "Content:" {
                in_content = true;
            }
            continue;
        }
        if let Some(value) = line.strip_prefix('{') {
            current_page = value.parse::<u32>().ok();
            continue;
        }
        if line.starts_with('}') {
            current_page = None;
            continue;
        }
        let Some(page) = current_page else { continue };
        let Some(body) = line.get(1..) else { continue };
        let Some((source, coordinates)) = body.split_once(':') else {
            continue;
        };
        let mut source_parts = source.split(',');
        let (Some(tag), Some(source_line)) = (source_parts.next(), source_parts.next()) else {
            continue;
        };
        let (Ok(tag), Ok(source_line)) = (tag.parse::<i32>(), source_line.parse::<u32>()) else {
            continue;
        };
        let Some(input_path) = inputs.get(&tag) else {
            continue;
        };
        let Ok(relative) = input_path.strip_prefix(source_dir) else {
            continue;
        };
        if relative.to_string_lossy().replace('\\', "/") != file_path {
            continue;
        }
        let position = coordinates.split(':').next().unwrap_or(coordinates);
        let mut position_parts = position.split(',');
        let (Some(node_x), Some(node_y)) = (position_parts.next(), position_parts.next()) else {
            continue;
        };
        let (Ok(node_x), Ok(node_y)) = (node_x.parse::<f64>(), node_y.parse::<f64>()) else {
            continue;
        };
        let scale = unit * magnification / 1000.0;
        if scale <= 0.0 {
            continue;
        }
        let distance = source_line.abs_diff(line_number.max(1));
        let position = WriterPdfPosition {
            page,
            x: ((node_x * scale) + x_offset) / SYNCTEX_UNITS_PER_PDF_POINT,
            y: ((node_y * scale) + y_offset) / SYNCTEX_UNITS_PER_PDF_POINT,
        };
        if best
            .as_ref()
            .is_none_or(|(best_distance, _)| distance < *best_distance)
        {
            best = Some((distance, position));
        }
    }

    best.map(|(_, position)| position)
}

fn synctex_source_position(
    app: &AppHandle,
    request: SyncTexEditRequest,
) -> Result<WriterSourcePosition, String> {
    if request.page == 0
        || !request.x.is_finite()
        || !request.y.is_finite()
        || request.x < 0.0
        || request.y < 0.0
    {
        return Err("PDF 定位坐标无效。".into());
    }
    let root = canonical_root(&request.root_path)?;
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("writer")
        .join(project_hash(&root));
    let source_dir = cache_root.join("source");
    let synctex_path = cache_root.join("output/output.synctex.gz");
    let file = fs::File::open(&synctex_path)
        .map_err(|_| "当前 PDF 没有 SyncTeX 数据，请重新编译。".to_string())?;
    let decoder = GzDecoder::new(file);
    let mut bytes = Vec::new();
    decoder
        .take(MAX_SYNCTEX_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取 SyncTeX 数据：{error}"))?;
    if bytes.len() as u64 > MAX_SYNCTEX_SIZE {
        return Err("SyncTeX 数据过大，无法定位。".into());
    }
    let content = String::from_utf8_lossy(&bytes);
    let position =
        parse_synctex_source_position(&content, &source_dir, request.page, request.x, request.y)
            .ok_or_else(|| "这个 PDF 位置没有对应的 LaTeX 源码。".to_string())?;
    checked_relative_path(&root, &position.file_path)?;
    Ok(position)
}

fn synctex_pdf_position(
    app: &AppHandle,
    request: SyncTexViewRequest,
) -> Result<WriterPdfPosition, String> {
    if request.line == 0 {
        return Err("LaTeX 行号无效。".into());
    }
    let root = canonical_root(&request.root_path)?;
    let relative = checked_relative_path(&root, &request.file_path)?;
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("writer")
        .join(project_hash(&root));
    let source_dir = cache_root.join("source");
    let synctex_path = cache_root.join("output/output.synctex.gz");
    let file = fs::File::open(&synctex_path)
        .map_err(|_| "当前 PDF 没有 SyncTeX 数据，请重新编译。".to_string())?;
    let decoder = GzDecoder::new(file);
    let mut bytes = Vec::new();
    decoder
        .take(MAX_SYNCTEX_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取 SyncTeX 数据：{error}"))?;
    if bytes.len() as u64 > MAX_SYNCTEX_SIZE {
        return Err("SyncTeX 数据过大，无法定位。".into());
    }
    let content = String::from_utf8_lossy(&bytes);
    parse_synctex_pdf_position(
        &content,
        &source_dir,
        &relative.to_string_lossy().replace('\\', "/"),
        request.line,
    )
    .ok_or_else(|| "当前源码位置没有对应的 PDF 坐标，请重新编译后重试。".to_string())
}

fn parse_diagnostics(log: &str) -> Vec<CompileDiagnostic> {
    let missing_file =
        Regex::new(r#"(?m)^!\s*(LaTeX Error:\s*File\s+[`']([^`']+)[`']\s+not found\.)\s*$"#)
            .expect("valid missing file regex");
    let file_line = Regex::new(r"(?m)^(.+?\.(?:tex|bib|cls|sty|bst)):(\d+):\s*(.+)$")
        .expect("valid diagnostic regex");
    let mut diagnostics = Vec::new();

    for capture in missing_file.captures_iter(log).take(20) {
        let message = capture[1].trim().to_string();
        if !diagnostics
            .iter()
            .any(|diagnostic: &CompileDiagnostic| diagnostic.message == message)
        {
            diagnostics.push(CompileDiagnostic {
                file: None,
                line: None,
                severity: "error".into(),
                message,
            });
        }
    }

    for capture in file_line.captures_iter(log).take(100) {
        let message = capture[3].trim().to_string();
        if diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message == message)
        {
            continue;
        }
        let severity = if message.to_ascii_lowercase().contains("warning") {
            "warning"
        } else {
            "error"
        };
        diagnostics.push(CompileDiagnostic {
            file: Some(capture[1].trim_start_matches("./").to_string()),
            line: capture[2].parse().ok(),
            severity: severity.into(),
            message,
        });
    }

    for line in log.lines().filter(|line| line.starts_with('!')).take(20) {
        let message = line.trim_start_matches('!').trim().to_string();
        if !message.is_empty()
            && !diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message == message)
        {
            diagnostics.push(CompileDiagnostic {
                file: None,
                line: None,
                severity: "error".into(),
                message,
            });
        }
    }
    diagnostics
}

fn compile_project(app: AppHandle, request: CompileRequest) -> Result<CompileResult, String> {
    let started = Instant::now();
    let root = canonical_root(&request.root_path)?;
    checked_relative_path(&root, &request.main_file)?;
    let runtime = runtime_status(Some(&app));
    let latexmk = runtime
        .latexmk_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "没有检测到 latexmk，请先安装本地 TeX 环境。".to_string())?;
    if !runtime
        .engines
        .iter()
        .any(|engine| engine == &request.engine)
    {
        return Err(format!("当前 TeX 环境不支持 {}。", request.engine));
    }
    ensure_managed_conference_packages(&app, &runtime)?;

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法创建编译缓存目录：{error}"))?
        .join("writer")
        .join(project_hash(&root));
    let source_dir = cache_root.join("source");
    let output_dir = cache_root.join("output");
    let preview_path = cache_root.join("preview.pdf");
    if source_dir.exists() {
        fs::remove_dir_all(&source_dir).map_err(|error| format!("无法刷新编译目录：{error}"))?;
    }
    if output_dir.exists() {
        fs::remove_dir_all(&output_dir).map_err(|error| format!("无法清理编译缓存：{error}"))?;
    }
    fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let (_, project_files) = discover_project_files(&root, Some(&request.main_file))?;
    copy_project_files(&root, &source_dir, &project_files)?;
    let conference_style_dir = ensure_conference_style_dir(&app)?;

    let engine_flag = match request.engine.as_str() {
        "pdflatex" => "-pdf",
        "xelatex" => "-xelatex",
        "lualatex" => "-lualatex",
        _ => return Err("不支持的 LaTeX 引擎。".into()),
    };
    let engine_rule = match request.engine.as_str() {
        "pdflatex" => "$pdflatex = 'pdflatex -no-shell-escape %O %S';",
        "xelatex" => "$xelatex = 'xelatex -no-shell-escape %O %S';",
        "lualatex" => "$lualatex = 'lualatex -no-shell-escape %O %S';",
        _ => unreachable!(),
    };

    let mut command = Command::new(latexmk);
    if let Some(bin_dir) = runtime
        .latexmk_path
        .as_ref()
        .and_then(|path| Path::new(path).parent())
    {
        let mut paths = vec![bin_dir.to_path_buf()];
        paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
        if let Ok(path) = env::join_paths(paths) {
            command.env("PATH", path);
        }
    }
    let tex_inputs = tex_search_path(&source_dir, &conference_style_dir);
    command
        .env("TEXINPUTS", &tex_inputs)
        .env("BSTINPUTS", &tex_inputs);
    command
        .current_dir(&source_dir)
        .arg("-jobname=output")
        .arg(format!("-auxdir={}", output_dir.to_string_lossy()))
        .arg(format!("-outdir={}", output_dir.to_string_lossy()))
        .args([
            "-g",
            "-synctex=1",
            "-interaction=nonstopmode",
            "-file-line-error",
            "-halt-on-error",
            "-time",
        ])
        .arg("-e")
        .arg(engine_rule)
        .arg(engine_flag)
        .arg(&request.main_file)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 latexmk：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取编译输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取编译错误。".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stream = stdout;
        let _ = stream.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stream = stderr;
        let _ = stream.read_to_end(&mut bytes);
        bytes
    });

    let process_status = match child
        .wait_timeout(COMPILE_TIMEOUT)
        .map_err(|error| error.to_string())?
    {
        Some(status) => Some(status),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let mut log = String::from_utf8_lossy(&stdout).into_owned();
    if !stderr.is_empty() {
        log.push('\n');
        log.push_str(&String::from_utf8_lossy(&stderr));
    }
    let latex_log_path = output_dir.join("output.log");
    if let Ok(latex_log) = fs::read_to_string(latex_log_path) {
        log.push_str("\n\n--- output.log ---\n");
        log.push_str(&latex_log);
    }
    if log.len() > 2_000_000 {
        log.truncate(2_000_000);
        log.push_str("\n[日志已截断]");
    }

    let compiled_pdf_path = output_dir.join("output.pdf");
    let compiled_pdf_available = compiled_pdf_path
        .metadata()
        .map(|value| value.len() > 0)
        .unwrap_or(false);
    let status = if process_status.is_none() {
        "timedout"
    } else if compiled_pdf_available && process_status.is_some_and(|value| value.success()) {
        "success"
    } else {
        "failure"
    };
    if compiled_pdf_available {
        let next_preview = cache_root.join("preview.next.pdf");
        fs::copy(&compiled_pdf_path, &next_preview)
            .map_err(|error| format!("无法保存 PDF 预览：{error}"))?;
        fs::rename(&next_preview, &preview_path)
            .map_err(|error| format!("无法更新 PDF 预览：{error}"))?;
    }
    Ok(CompileResult {
        status: status.into(),
        duration_ms: started.elapsed().as_millis(),
        diagnostics: parse_diagnostics(&log),
        log,
        pdf_available: preview_path
            .metadata()
            .map(|value| value.len() > 0)
            .unwrap_or(false),
    })
}

#[tauri::command]
pub fn get_latex_runtime_status(app: AppHandle) -> LatexRuntimeStatus {
    runtime_status(Some(&app))
}

#[tauri::command]
pub async fn install_managed_latex_runtime(app: AppHandle) -> Result<LatexRuntimeStatus, String> {
    let _install_guard = RuntimeInstallGuard::acquire()?;
    emit_install_progress(&app, "preparing", "正在获取 TeX 发行信息", 2, 0, 0);
    let client = crate::http_client()?;
    let release = client
        .get(TINYTEX_RELEASE_API)
        .send()
        .await
        .map_err(|error| format!("无法获取 TeX 发行信息：{error}"))?
        .error_for_status()
        .map_err(|error| format!("TeX 发行信息请求失败：{error}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("无法解析 TeX 发行信息：{error}"))?;
    let asset_name = runtime_asset_name()?;
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| format!("发行版中没有适合当前平台的 {asset_name}。"))?;
    let expected_digest = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or_else(|| "TeX 安装包没有 SHA-256 校验信息。".to_string())?
        .to_ascii_lowercase();

    let download_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法确定下载目录：{error}"))?
        .join("runtime-downloads");
    fs::create_dir_all(&download_dir).map_err(|error| format!("无法创建下载目录：{error}"))?;
    let archive_path = download_dir.join(&asset.name);
    let partial_path = download_dir.join(format!("{}.part", asset.name));
    let _ = fs::remove_file(&partial_path);

    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("无法下载 TeX 环境：{error}"))?
        .error_for_status()
        .map_err(|error| format!("TeX 环境下载失败：{error}"))?;
    let total = response.content_length().unwrap_or(asset.size);
    let mut file =
        fs::File::create(&partial_path).map_err(|error| format!("无法创建下载文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("下载 TeX 环境时连接中断：{error}"))?
    {
        file.write_all(&chunk)
            .map_err(|error| format!("无法写入 TeX 安装包：{error}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            ((downloaded.saturating_mul(70) / total).min(70)) as u8
        } else {
            20
        };
        emit_install_progress(
            &app,
            "downloading",
            "正在下载 TeX 环境",
            percent,
            downloaded,
            total,
        );
    }
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    emit_install_progress(&app, "verifying", "正在校验安装包", 76, downloaded, total);
    let actual_digest = format!("{:x}", hasher.finalize());
    if actual_digest != expected_digest {
        let _ = fs::remove_file(&partial_path);
        return Err("TeX 安装包校验失败，已删除下载文件。".into());
    }
    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|error| format!("无法替换旧安装包：{error}"))?;
    }
    fs::rename(&partial_path, &archive_path).map_err(|error| format!("无法保存安装包：{error}"))?;

    emit_install_progress(
        &app,
        "installing",
        "正在解压和配置 TeX 环境",
        82,
        downloaded,
        total,
    );
    let install_app = app.clone();
    let install_archive = archive_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        install_extracted_runtime(&install_app, &install_archive)
    })
    .await
    .map_err(|error| format!("TeX 安装任务异常退出：{error}"))??;
    let package_app = app.clone();
    let package_runtime = runtime_status(Some(&app));
    tauri::async_runtime::spawn_blocking(move || {
        ensure_managed_conference_packages(&package_app, &package_runtime)
    })
    .await
    .map_err(|error| format!("TeX 依赖配置任务异常退出：{error}"))??;
    let _ = fs::remove_file(&archive_path);
    emit_install_progress(&app, "complete", "TeX 环境已就绪", 100, downloaded, total);
    Ok(runtime_status(Some(&app)))
}

#[tauri::command]
pub fn uninstall_managed_latex_runtime(app: AppHandle) -> Result<LatexRuntimeStatus, String> {
    let root = managed_runtime_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| format!("无法移除托管 TeX 环境：{error}"))?;
    }
    Ok(runtime_status(Some(&app)))
}

#[tauri::command]
pub fn open_writer_project(
    app: AppHandle,
    root_path: String,
    entry_file: Option<String>,
) -> Result<WriterProject, String> {
    let root = canonical_root(&root_path)?;
    let (main_file, related) = discover_project_files(&root, entry_file.as_deref())?;
    let files = related
        .iter()
        .map(|relative| writer_file_entry(&root, relative))
        .collect::<Result<Vec<_>, _>>()?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("LaTeX project")
        .to_string();
    let id = crate::writer_store::remember_project(&app, &root, &name, main_file.as_deref())?;
    Ok(WriterProject {
        id,
        name,
        root_path: root.to_string_lossy().into_owned(),
        main_file,
        files,
    })
}

#[tauri::command]
pub fn resolve_writer_file(file_path: String) -> Result<WriterFileLocation, String> {
    let file =
        fs::canonicalize(file_path).map_err(|error| format!("无法打开 LaTeX 文档：{error}"))?;
    if !file.is_file()
        || !file
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("tex"))
    {
        return Err("请选择一个 .tex 文档。".into());
    }
    let initial_root = file
        .parent()
        .ok_or_else(|| "LaTeX 文档没有有效的项目目录。".to_string())?;
    let root = initial_root
        .ancestors()
        .take(8)
        .find(|directory| directory_has_root_tex(directory))
        .unwrap_or(initial_root);
    let relative = file.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(WriterFileLocation {
        root_path: root.to_string_lossy().into_owned(),
        relative_path: relative.to_string_lossy().replace('\\', "/"),
    })
}

#[tauri::command]
pub fn read_writer_file(root_path: String, relative_path: String) -> Result<String, String> {
    let root = canonical_root(&root_path)?;
    let path = checked_relative_path(&root, &relative_path)?;
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > MAX_TEXT_FILE_SIZE || !is_editable(&path) {
        return Err("这个文件不能在文本编辑器中打开。".into());
    }
    fs::read_to_string(path).map_err(|error| format!("无法读取文件：{error}"))
}

#[tauri::command]
pub fn write_writer_file(
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let root = canonical_root(&root_path)?;
    let path = checked_relative_path(&root, &relative_path)?;
    if !is_editable(&path) || content.len() as u64 > MAX_TEXT_FILE_SIZE {
        return Err("这个文件不能作为项目文本保存。".into());
    }
    fs::write(path, content).map_err(|error| format!("无法保存文件：{error}"))
}

#[tauri::command]
pub async fn compile_writer_project(
    app: AppHandle,
    request: CompileRequest,
) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || compile_project(app, request))
        .await
        .map_err(|error| format!("编译任务异常退出：{error}"))?
}

#[tauri::command]
pub fn read_writer_pdf(app: AppHandle, root_path: String) -> Result<Response, String> {
    let root = canonical_root(&root_path)?;
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("writer")
        .join(project_hash(&root))
        .join("preview.pdf");
    let bytes = fs::read(path).map_err(|error| format!("无法读取编译后的 PDF：{error}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn writer_synctex_edit(
    app: AppHandle,
    request: SyncTexEditRequest,
) -> Result<WriterSourcePosition, String> {
    synctex_source_position(&app, request)
}

#[tauri::command]
pub fn writer_synctex_view(
    app: AppHandle,
    request: SyncTexViewRequest,
) -> Result<WriterPdfPosition, String> {
    synctex_pdf_position(&app, request)
}

#[cfg(test)]
mod tests {
    use super::{
        copy_project_files, discover_project_files, parse_diagnostics, parse_synctex_pdf_position,
        parse_synctex_source_position,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    fn temporary_project(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("whalepaper-{name}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn maps_pdf_coordinates_to_project_source_lines() {
        let source = PathBuf::from("/tmp/whalepaper-synctex/source");
        let content = concat!(
            "SyncTeX Version:1\n",
            "Input:1:/tmp/whalepaper-synctex/source/main.tex\n",
            "Input:2:/tmp/whalepaper-synctex/source/sec/method.tex\n",
            "Input:3:/tmp/whalepaper-synctex/system/article.cls\n",
            "Output:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n",
            "{1\n",
            "x1,12:6578176,6578176\n",
            "x2,47:13156352,19734528\n",
            "x3,99:13156352,19734528\n",
            "}\n",
        );

        let position = parse_synctex_source_position(content, &source, 1, 200.0, 300.0)
            .expect("source position");
        assert_eq!(position.file_path, "sec/method.tex");
        assert_eq!(position.line, 47);
    }

    #[test]
    fn maps_inputs_declared_between_synctex_pages() {
        let source = PathBuf::from("/tmp/whalepaper-synctex/source");
        let content = concat!(
            "SyncTeX Version:1\n",
            "Input:1:/tmp/whalepaper-synctex/source/main.tex\n",
            "Output:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n",
            "{1\n",
            "x1,12:6578176,6578176\n",
            "}1\n",
            "Input:2:/tmp/whalepaper-synctex/source/sec/method.tex\n",
            "{2\n",
            "x2,15:29207000,18490000\n",
            "}2\n",
        );
        let position = parse_synctex_source_position(content, &source, 2, 444.0, 281.1)
            .expect("source position");
        assert_eq!(position.file_path, "sec/method.tex");
        assert_eq!(position.line, 15);
    }

    #[test]
    fn maps_project_source_lines_to_pdf_coordinates() {
        let source = PathBuf::from("/tmp/whalepaper-synctex/source");
        let content = concat!(
            "SyncTeX Version:1\n",
            "Input:1:/tmp/whalepaper-synctex/source/main.tex\n",
            "Output:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n",
            "{3\n",
            "x1,18:6578176,13156352\n",
            "}\n",
        );
        let position =
            parse_synctex_pdf_position(content, &source, "main.tex", 18).expect("pdf position");
        assert_eq!(position.page, 3);
        assert!((position.x - 100.0).abs() < 0.01);
        assert!((position.y - 200.0).abs() < 0.01);
    }

    #[test]
    fn discovers_only_files_referenced_by_the_latex_project() {
        let root = temporary_project("related-files");
        let output = temporary_project("related-output");
        fs::create_dir_all(root.join("sec")).expect("create section directory");
        fs::create_dir_all(root.join("figures")).expect("create figures directory");
        fs::create_dir_all(root.join("vendor/repo")).expect("create nested repository");
        fs::write(
            root.join("main.tex"),
            r#"\documentclass{article}
\usepackage{graphicx}
\input{sec/intro}
% \input{vendor/repo/standalone}
\includegraphics{figures/result}
\begin{document}Test\end{document}"#,
        )
        .expect("write main document");
        fs::write(root.join("sec/intro.tex"), "Related section").expect("write included section");
        fs::write(root.join("figures/result.png"), b"test image").expect("write referenced image");
        fs::write(root.join("vendor/repo/README.md"), "Unrelated repository")
            .expect("write unrelated readme");
        fs::write(root.join("vendor/repo/train.py"), "print('unrelated')")
            .expect("write unrelated source");
        fs::write(
            root.join("vendor/repo/standalone.tex"),
            "\\documentclass{article}",
        )
        .expect("write nested standalone document");
        let root = fs::canonicalize(root).expect("canonicalize temporary project");

        let (main_file, related) =
            discover_project_files(&root, None).expect("discover project files");

        assert_eq!(main_file.as_deref(), Some("main.tex"));
        assert_eq!(
            related,
            ["figures/result.png", "main.tex", "sec/intro.tex"]
                .into_iter()
                .map(PathBuf::from)
                .collect()
        );
        copy_project_files(&root, &output, &related).expect("copy related project files");
        assert!(output.join("main.tex").is_file());
        assert!(output.join("sec/intro.tex").is_file());
        assert!(output.join("figures/result.png").is_file());
        assert!(!output.join("vendor/repo/README.md").exists());

        fs::remove_dir_all(&root).expect("remove temporary project");
        fs::remove_dir_all(&output).expect("remove temporary output");
    }

    #[test]
    fn prefers_the_paper_over_a_standalone_checklist() {
        let root = temporary_project("main-document-ranking");
        fs::create_dir_all(&root).expect("create project directory");
        fs::write(
            root.join("VeriCal-GRPO.tex"),
            r#"\documentclass{article}
\title{Research Paper}
\author{Anonymous Authors}
\begin{document}
\maketitle
\begin{abstract}Paper abstract.\end{abstract}
\section{Introduction}
Paper body.
\bibliography{references}
\end{document}"#,
        )
        .expect("write paper document");
        fs::write(
            root.join("ReproducibilityChecklist.tex"),
            r#"\makeatletter
\@ifundefined{isChecklistMainFile}{\newif\ifreproStandalone\reproStandalonetrue}{}
\makeatother
\ifreproStandalone
\documentclass{article}
\begin{document}
\fi
\section*{Reproducibility Checklist}
\ifreproStandalone\end{document}\fi"#,
        )
        .expect("write checklist document");
        let root = fs::canonicalize(root).expect("canonicalize project");

        let (detected, _) = discover_project_files(&root, None).expect("detect main document");
        assert_eq!(detected.as_deref(), Some("VeriCal-GRPO.tex"));

        // Repair projects whose previously stored automatic choice was the checklist.
        let (repaired, _) = discover_project_files(&root, Some("ReproducibilityChecklist.tex"))
            .expect("repair stored main document");
        assert_eq!(repaired.as_deref(), Some("VeriCal-GRPO.tex"));

        fs::remove_dir_all(&root).expect("remove temporary project");
    }

    #[test]
    fn missing_latex_file_is_the_primary_diagnostic_and_is_deduplicated() {
        let log = r#"! LaTeX Error: File `aaai2027.sty' not found.
main.tex:2: Emergency stop.
! LaTeX Error: File `aaai2027.sty' not found.
!  ==> Fatal error occurred, no output PDF file produced!"#;

        let diagnostics = parse_diagnostics(log);

        assert_eq!(
            diagnostics[0].message,
            "LaTeX Error: File `aaai2027.sty' not found."
        );
        assert_eq!(
            diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.message.contains("aaai2027.sty"))
                .count(),
            1
        );
    }
}
