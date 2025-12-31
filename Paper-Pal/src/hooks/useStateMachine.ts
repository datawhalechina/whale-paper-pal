/**
 * React hook for integrating StateMachine with the app
 * Provides a convenient interface for components to interact with the state machine
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { StateMachine, TransitionTrigger } from '../state/StateMachine';

/**
 * Hook that creates and manages a StateMachine instance
 * Syncs state changes with the Zustand app store
 */
export function useStateMachine() {
  const { avatarState, setAvatarState } = useAppStore();
  const stateMachineRef = useRef<StateMachine | null>(null);

  // Initialize state machine on mount
  useEffect(() => {
    const sm = new StateMachine(avatarState);

    // Subscribe to state changes and sync with app store
    const unsubscribe = sm.onStateChange((newState) => {
      setAvatarState(newState);
    });

    stateMachineRef.current = sm;

    return () => {
      unsubscribe();
      sm.dispose();
      stateMachineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external state changes to state machine
  useEffect(() => {
    if (stateMachineRef.current && stateMachineRef.current.currentState !== avatarState) {
      stateMachineRef.current.forceState(avatarState);
    }
  }, [avatarState]);

  /**
   * Trigger a state transition
   */
  const transition = useCallback((trigger: TransitionTrigger): boolean => {
    if (stateMachineRef.current) {
      return stateMachineRef.current.transition(trigger);
    }
    return false;
  }, []);

  /**
   * Handle avatar click - transitions to Active state
   * Requirement 2.3: WHEN a user clicks on the avatar, THE State_Machine SHALL transition to Active state
   */
  const handleClick = useCallback(() => {
    return transition('click');
  }, [transition]);

  /**
   * Handle new paper discovery - transitions to Alert state
   * Requirement 2.2: WHEN a new high-score paper is discovered, THE State_Machine SHALL transition to Alert state
   */
  const handleNewPaper = useCallback(() => {
    return transition('newPaper');
  }, [transition]);

  /**
   * Handle dismiss action - returns to Idle state
   */
  const handleDismiss = useCallback(() => {
    return transition('dismiss');
  }, [transition]);

  /**
   * Reset the idle timer (call when user interacts during Active state)
   */
  const resetIdleTimer = useCallback(() => {
    if (stateMachineRef.current) {
      stateMachineRef.current.resetIdleTimer();
    }
  }, []);

  /**
   * Check if a transition is valid
   */
  const canTransition = useCallback((trigger: TransitionTrigger): boolean => {
    if (stateMachineRef.current) {
      return stateMachineRef.current.canTransition(trigger);
    }
    return false;
  }, []);

  return {
    currentState: avatarState,
    transition,
    handleClick,
    handleNewPaper,
    handleDismiss,
    resetIdleTimer,
    canTransition,
  };
}
