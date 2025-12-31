/**
 * Chat Interface Module
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

export { ChatInterface } from './ChatInterface';
export { ChatMessageComponent } from './ChatMessage';
export { useChatInterface } from './useChatInterface';
export {
  type ChatMessage,
  type ChatContext,
  type QuickCommand,
  type ChatInterfaceProps,
  type ChatInterfaceState,
  QUICK_COMMANDS,
  isQuickCommand,
  createChatMessage,
  createChatContext,
  addMessageToHistory,
  clearChatContext,
  validateChatContextState,
} from './types';
export {
  type QuickCommandDefinition,
  QUICK_COMMAND_DEFINITIONS,
  getQuickCommandDefinition,
  executeQuickCommand,
  matchQuickCommand,
  getAvailableQuickCommands,
  isRecognizedCommand,
} from './quickCommands';
