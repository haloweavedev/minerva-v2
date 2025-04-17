'use client';

import { PreviewMessage, ThinkingMessage } from './message'; // Ensure path is correct
import { useScrollToBottom } from './use-scroll-to-bottom'; // Ensure path is correct
import { Greeting } from './greeting'; // Assuming you create this next
import { memo } from 'react';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';

interface MessagesProps {
  // Removed chatId, votes, reload, isReadonly, isArtifactVisible
  status: UseChatHelpers['status'];
  messages: UseChatHelpers['messages'];
  // Removed setMessages for simplicity if not needed directly here
}

function PureMessages({
  status,
  messages,
}: MessagesProps) {
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4 pb-4" // Added pb-4
    >
      {messages.length === 0 && <Greeting />}

      {messages.map((message, index) => (
        <PreviewMessage
          key={message.id}
          message={message}
          isLoading={status === 'streaming' && messages.length - 1 === index}
          // Removed props: chatId, vote, setMessages, reload, isReadonly
        />
      ))}

      {/* Simplified thinking state check */}
      {status === 'streaming' && messages[messages.length - 1]?.role === 'user' && <ThinkingMessage />}

      <div
        ref={messagesEndRef}
        className="shrink-0 h-4" // Adjusted height
      />
    </div>
  );
}

// Simplified memoization
export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  return true;
}); 