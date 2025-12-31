/**
 * State Machine for Avatar
 * Manages Idle/Alert/Active states and transitions
 *
 * State Transition Graph:
 * ┌───────┐  newPaper   ┌───────┐
 * │ Idle  │ ──────────► │ Alert │
 * └───────┘             └───────┘
 *     ▲                     │
 *     │ timeout             │ click
 *     │                     ▼
 *     │               ┌─────────┐
 *     └────────────── │ Active  │
 *          timeout    └─────────┘
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

export type AvatarState = 'idle' | 'alert' | 'active';
export type TransitionTrigger = 'click' | 'newPaper' | 'timeout' | 'dismiss';

export interface StateTransition {
  from: AvatarState;
  to: AvatarState;
  trigger: TransitionTrigger;
}

type StateChangeCallback = (state: AvatarState, previousState: AvatarState) => void;

/**
 * Valid state transitions as defined in the design document
 * Property 2: State Machine Transition Correctness
 */
const VALID_TRANSITIONS: Record<AvatarState, Partial<Record<TransitionTrigger, AvatarState>>> = {
  idle: {
    newPaper: 'alert',
    click: 'active',
  },
  alert: {
    click: 'active',
    timeout: 'idle',
    dismiss: 'idle',
  },
  active: {
    timeout: 'idle',
    dismiss: 'idle',
  },
};

export class StateMachine {
  private _currentState: AvatarState = 'idle';
  private _callbacks: StateChangeCallback[] = [];
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _defaultIdleTimeout: number = 30000; // 30 seconds as per Requirement 2.4

  constructor(initialState: AvatarState = 'idle') {
    this._currentState = initialState;
  }

  /**
   * Get the current state
   */
  get currentState(): AvatarState {
    return this._currentState;
  }

  /**
   * Transition to a new state based on the trigger
   * Returns true if transition was successful, false otherwise
   *
   * Requirements: 2.1, 2.2, 2.3
   */
  transition(trigger: TransitionTrigger): boolean {
    const targetState = VALID_TRANSITIONS[this._currentState][trigger];

    if (targetState === undefined) {
      // Invalid transition - stay in current state
      return false;
    }

    const previousState = this._currentState;
    this._currentState = targetState;

    // Clear any existing idle timer
    this.clearIdleTimer();

    // Start idle timer if entering Active state (Requirement 2.4)
    if (targetState === 'active') {
      this.startIdleTimer(this._defaultIdleTimeout);
    }

    // Notify all callbacks
    this._notifyStateChange(previousState);

    return true;
  }

  /**
   * Get the target state for a given trigger without actually transitioning
   * Useful for testing and validation
   */
  getTargetState(trigger: TransitionTrigger): AvatarState | undefined {
    return VALID_TRANSITIONS[this._currentState][trigger];
  }

  /**
   * Check if a transition is valid from the current state
   */
  canTransition(trigger: TransitionTrigger): boolean {
    return VALID_TRANSITIONS[this._currentState][trigger] !== undefined;
  }

  /**
   * Register a callback to be called when state changes
   * Returns an unsubscribe function
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this._callbacks.push(callback);
    return () => {
      const index = this._callbacks.indexOf(callback);
      if (index > -1) {
        this._callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Start the idle timer
   * When timer expires, triggers a timeout transition
   *
   * Requirement 2.4: Active 状态 30 秒无交互返回 Idle
   */
  startIdleTimer(timeoutMs: number = this._defaultIdleTimeout): void {
    this.clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this.transition('timeout');
    }, timeoutMs);
  }

  /**
   * Clear the idle timer
   */
  clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Reset the idle timer (useful when user interacts during Active state)
   */
  resetIdleTimer(): void {
    if (this._currentState === 'active') {
      this.startIdleTimer(this._defaultIdleTimeout);
    }
  }

  /**
   * Set the default idle timeout duration
   */
  setDefaultIdleTimeout(timeoutMs: number): void {
    this._defaultIdleTimeout = timeoutMs;
  }

  /**
   * Get the default idle timeout duration
   */
  getDefaultIdleTimeout(): number {
    return this._defaultIdleTimeout;
  }

  /**
   * Check if idle timer is currently running
   */
  isIdleTimerRunning(): boolean {
    return this._idleTimer !== null;
  }

  /**
   * Force set state (for initialization/testing purposes)
   * Does not trigger callbacks or timers
   */
  forceState(state: AvatarState): void {
    this._currentState = state;
  }

  /**
   * Notify all registered callbacks of state change
   */
  private _notifyStateChange(previousState: AvatarState): void {
    for (const callback of this._callbacks) {
      callback(this._currentState, previousState);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearIdleTimer();
    this._callbacks = [];
  }
}

/**
 * Static helper to get the expected target state for a given state and trigger
 * Useful for property-based testing
 */
export function getExpectedTransition(
  fromState: AvatarState,
  trigger: TransitionTrigger
): AvatarState | undefined {
  return VALID_TRANSITIONS[fromState][trigger];
}

/**
 * Get all valid transitions as an array
 * Useful for property-based testing
 */
export function getAllValidTransitions(): StateTransition[] {
  const transitions: StateTransition[] = [];

  for (const from of ['idle', 'alert', 'active'] as AvatarState[]) {
    for (const trigger of ['click', 'newPaper', 'timeout', 'dismiss'] as TransitionTrigger[]) {
      const to = VALID_TRANSITIONS[from][trigger];
      if (to !== undefined) {
        transitions.push({ from, to, trigger });
      }
    }
  }

  return transitions;
}
