/**
 * Quick Commands Handler
 * Handles quick command recognition and execution
 *
 * Requirements: 8.3 - Support quick commands ("看公式", "看代码链接")
 * Property 11: Quick Command Recognition
 */

import type { QuickCommand, ChatContext } from './types';

/**
 * Quick command definitions with their handlers
 */
export interface QuickCommandDefinition {
  command: QuickCommand;
  description: string;
  icon: string;
  /** Extract relevant information from abstract */
  extractFromAbstract: (abstract: string) => string;
}

/**
 * All supported quick commands
 * Property 11: Quick Command Recognition
 */
export const QUICK_COMMAND_DEFINITIONS: QuickCommandDefinition[] = [
  {
    command: '看公式',
    description: '提取论文中的数学公式',
    icon: '📐',
    extractFromAbstract: (abstract: string) => {
      // Look for mathematical notation patterns in abstract
      const mathPatterns = [
        /\$[^$]+\$/g, // LaTeX inline math
        /\\\([^)]+\\\)/g, // LaTeX inline math alt
        /\\\[[^\]]+\\\]/g, // LaTeX display math
        /[A-Z]\s*=\s*[^.]+/g, // Simple equations
        /\b(equation|formula|theorem|lemma)\b/gi, // Math keywords
      ];

      const findings: string[] = [];
      
      for (const pattern of mathPatterns) {
        const matches = abstract.match(pattern);
        if (matches) {
          findings.push(...matches);
        }
      }

      if (findings.length > 0) {
        return `📐 在摘要中发现以下数学相关内容：\n\n${findings.slice(0, 5).map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n💡 提示：完整公式请查看论文原文。`;
      }

      return '📐 摘要中未发现明显的数学公式。建议查看论文原文获取详细公式。';
    },
  },
  {
    command: '看代码链接',
    description: '提取论文相关的代码仓库链接',
    icon: '🔗',
    extractFromAbstract: (abstract: string) => {
      // Look for code/repository patterns
      const codePatterns = [
        /https?:\/\/github\.com\/[^\s)]+/gi,
        /https?:\/\/gitlab\.com\/[^\s)]+/gi,
        /https?:\/\/bitbucket\.org\/[^\s)]+/gi,
        /https?:\/\/huggingface\.co\/[^\s)]+/gi,
        /\bgithub\.com\/[^\s)]+/gi,
        /\bcode\s+(?:is\s+)?(?:available|released)\s+(?:at|on)\s+[^\s.]+/gi,
      ];

      const findings: string[] = [];
      
      for (const pattern of codePatterns) {
        const matches = abstract.match(pattern);
        if (matches) {
          findings.push(...matches);
        }
      }

      // Also check for code-related keywords
      const hasCodeMention = /\b(code|implementation|repository|open[- ]?source)\b/i.test(abstract);

      if (findings.length > 0) {
        return `🔗 发现以下代码相关链接：\n\n${findings.slice(0, 5).map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
      }

      if (hasCodeMention) {
        return '🔗 摘要中提到了代码/实现，但未找到直接链接。建议查看论文原文或作者主页获取代码。';
      }

      return '🔗 摘要中未发现代码链接。该论文可能未公开代码，或代码链接在论文正文中。';
    },
  },
];

/**
 * Get quick command definition by command string
 */
export function getQuickCommandDefinition(
  command: QuickCommand
): QuickCommandDefinition | undefined {
  return QUICK_COMMAND_DEFINITIONS.find((def) => def.command === command);
}

/**
 * Execute a quick command against a chat context
 * Property 11: Quick Command Recognition
 */
export function executeQuickCommand(
  command: QuickCommand,
  context: ChatContext
): string {
  const definition = getQuickCommandDefinition(command);
  
  if (!definition) {
    return `未知的快捷指令: ${command}`;
  }

  return definition.extractFromAbstract(context.abstract);
}

/**
 * Check if input matches any quick command
 * Property 11: Quick Command Recognition
 */
export function matchQuickCommand(input: string): QuickCommand | null {
  const trimmed = input.trim();
  
  for (const def of QUICK_COMMAND_DEFINITIONS) {
    if (def.command === trimmed) {
      return def.command;
    }
  }
  
  return null;
}

/**
 * Get all available quick commands
 */
export function getAvailableQuickCommands(): QuickCommand[] {
  return QUICK_COMMAND_DEFINITIONS.map((def) => def.command);
}

/**
 * Validate that a command is recognized
 * Property 11: Quick Command Recognition
 */
export function isRecognizedCommand(command: string): boolean {
  return matchQuickCommand(command) !== null;
}
