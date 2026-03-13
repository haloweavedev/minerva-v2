'use client';

import { PreviewMessage, ThinkingMessage } from './message';
import { useScrollToBottom } from './use-scroll-to-bottom';
import { Greeting } from './greeting';
import { memo } from 'react';
import equal from 'fast-deep-equal';
import type { UIMessage } from 'ai';

interface MessagesProps {
  status: string;
  messages: UIMessage[];
  onQueryClick?: (query: string) => void;
}

function PureMessages({
  status,
  messages,
  onQueryClick,
}: MessagesProps) {
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-5 flex-1 overflow-y-auto pt-4 pb-4 chat-messages-main"
    >
      {messages.length === 0 && <Greeting onQueryClick={onQueryClick} />}

      {messages.map((message, index) => (
        <PreviewMessage
          key={message.id}
          message={message}
          isLoading={status === 'streaming' && messages.length - 1 === index}
        />
      ))}

      {status === 'streaming' && messages[messages.length - 1]?.role === 'user' && <ThinkingMessage />}

      <div
        ref={messagesEndRef}
        className="shrink-0 h-6 chat-messages-end"
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  return true;
});
