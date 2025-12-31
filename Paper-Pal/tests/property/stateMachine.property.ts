import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  StateMachine,
  AvatarState,
  TransitionTrigger,
  getExpectedTransition,
  getAllValidTransitions,
} from '../../src/state/StateMachine';

/**
 * Feature: paper-pal, Property 2: State Machine Transition Correctness
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 *
 * For any valid (state, trigger) pair, the State_Machine SHALL transition to the
 * correct target state as defined by the state transition graph:
 * - (idle, newPaper) → alert
 * - (idle, click) → active
 * - (alert, click) → active
 * - (alert, timeout) → idle
 * - (active, timeout) → idle
 * - (active, dismiss) → idle
 */

// Generators for state machine testing
const avatarStateArb: fc.Arbitrary<AvatarState> = fc.constantFrom('idle', 'alert', 'active');
const transitionTriggerArb: fc.Arbitrary<TransitionTrigger> = fc.constantFrom(
  'click',
  'newPaper',
  'timeout',
  'dismiss'
);

// Expected transitions as defined in design document
const EXPECTED_TRANSITIONS: Record<AvatarState, Partial<Record<TransitionTrigger, AvatarState>>> = {
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

describe('Property 2: State Machine Transition Correctness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should transition to correct target state for all valid (state, trigger) pairs', () => {
    fc.assert(
      fc.property(avatarStateArb, transitionTriggerArb, (initialState, trigger) => {
        const sm = new StateMachine(initialState);
        const expectedTarget = EXPECTED_TRANSITIONS[initialState][trigger];

        const transitionResult = sm.transition(trigger);

        if (expectedTarget !== undefined) {
          // Valid transition - should succeed and reach expected state
          expect(transitionResult).toBe(true);
          expect(sm.currentState).toBe(expectedTarget);
        } else {
          // Invalid transition - should fail and stay in current state
          expect(transitionResult).toBe(false);
          expect(sm.currentState).toBe(initialState);
        }

        sm.dispose();
      }),
      { numRuns: 100 }
    );
  });

  it('should match getExpectedTransition helper for all state/trigger combinations', () => {
    fc.assert(
      fc.property(avatarStateArb, transitionTriggerArb, (state, trigger) => {
        const expected = EXPECTED_TRANSITIONS[state][trigger];
        const helperResult = getExpectedTransition(state, trigger);

        expect(helperResult).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('should call onStateChange callback with correct states for valid transitions', () => {
    fc.assert(
      fc.property(avatarStateArb, transitionTriggerArb, (initialState, trigger) => {
        const sm = new StateMachine(initialState);
        const expectedTarget = EXPECTED_TRANSITIONS[initialState][trigger];

        let callbackCalled = false;
        let receivedNewState: AvatarState | null = null;
        let receivedPrevState: AvatarState | null = null;

        sm.onStateChange((newState, prevState) => {
          callbackCalled = true;
          receivedNewState = newState;
          receivedPrevState = prevState;
        });

        sm.transition(trigger);

        if (expectedTarget !== undefined) {
          // Valid transition - callback should be called
          expect(callbackCalled).toBe(true);
          expect(receivedNewState).toBe(expectedTarget);
          expect(receivedPrevState).toBe(initialState);
        } else {
          // Invalid transition - callback should not be called
          expect(callbackCalled).toBe(false);
        }

        sm.dispose();
      }),
      { numRuns: 100 }
    );
  });

  it('should start idle timer when entering Active state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('idle', 'alert') as fc.Arbitrary<AvatarState>,
        (initialState) => {
          const sm = new StateMachine(initialState);

          // Transition to active via click
          sm.transition('click');

          // Timer should be running
          expect(sm.isIdleTimerRunning()).toBe(true);
          expect(sm.currentState).toBe('active');

          sm.dispose();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should auto-transition from Active to Idle after timeout (Requirement 2.4)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        (timeoutMs) => {
          const sm = new StateMachine('idle');

          // Transition to active
          sm.transition('click');
          expect(sm.currentState).toBe('active');

          // Set custom timeout and restart timer
          sm.setDefaultIdleTimeout(timeoutMs);
          sm.startIdleTimer(timeoutMs);

          // Advance time just before timeout
          vi.advanceTimersByTime(timeoutMs - 1);
          expect(sm.currentState).toBe('active');

          // Advance past timeout
          vi.advanceTimersByTime(2);
          expect(sm.currentState).toBe('idle');

          sm.dispose();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should clear idle timer when transitioning away from Active', () => {
    const sm = new StateMachine('active');
    sm.startIdleTimer(30000);

    expect(sm.isIdleTimerRunning()).toBe(true);

    // Transition to idle via dismiss
    sm.transition('dismiss');

    expect(sm.currentState).toBe('idle');
    expect(sm.isIdleTimerRunning()).toBe(false);

    sm.dispose();
  });

  it('should preserve all valid transitions from getAllValidTransitions helper', () => {
    const allTransitions = getAllValidTransitions();

    // Verify each transition in the list is valid
    for (const { from, to, trigger } of allTransitions) {
      const sm = new StateMachine(from);
      const result = sm.transition(trigger);

      expect(result).toBe(true);
      expect(sm.currentState).toBe(to);

      sm.dispose();
    }

    // Verify count matches expected (7 valid transitions):
    // idle->alert (newPaper), idle->active (click),
    // alert->active (click), alert->idle (timeout), alert->idle (dismiss),
    // active->idle (timeout), active->idle (dismiss)
    expect(allTransitions.length).toBe(7);
  });

  it('should allow unsubscribing from state change callbacks', () => {
    fc.assert(
      fc.property(avatarStateArb, (initialState) => {
        const sm = new StateMachine(initialState);
        let callCount = 0;

        const unsubscribe = sm.onStateChange(() => {
          callCount++;
        });

        // First transition (if valid)
        if (sm.canTransition('click')) {
          sm.transition('click');
          expect(callCount).toBe(1);
        }

        // Unsubscribe
        unsubscribe();

        // Reset state and try another transition
        sm.forceState('idle');
        sm.transition('newPaper');

        // Callback should not have been called again
        expect(callCount).toBeLessThanOrEqual(1);

        sm.dispose();
      }),
      { numRuns: 100 }
    );
  });

  it('should correctly report canTransition for all state/trigger combinations', () => {
    fc.assert(
      fc.property(avatarStateArb, transitionTriggerArb, (state, trigger) => {
        const sm = new StateMachine(state);
        const expectedTarget = EXPECTED_TRANSITIONS[state][trigger];

        const canTransitionResult = sm.canTransition(trigger);

        expect(canTransitionResult).toBe(expectedTarget !== undefined);

        sm.dispose();
      }),
      { numRuns: 100 }
    );
  });
});
