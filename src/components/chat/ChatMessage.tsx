import React from "react";
import type { ConversationMessage, TodoCandidate } from "../../../shared/types";
import { PlanProposalCard } from "./PlanProposalCard";

export function ChatMessage({
  message,
  compact = false,
  busy,
  onAccept,
  onDismiss,
  onChangeItems
}: {
  message: ConversationMessage;
  compact?: boolean;
  busy: boolean;
  onAccept(): void;
  onDismiss(): void;
  onChangeItems(items: TodoCandidate[]): void;
}) {
  return (
    <div className={`message ${message.role} ${message.taskDraftProposal ? "with-draft" : ""}`}>
      <span>{message.text}</span>
      {message.taskDraftProposal && (
        <PlanProposalCard
          plan={message.taskDraftProposal}
          compact={compact}
          busy={busy}
          status={message.taskDraftStatus ?? "pending"}
          onAccept={onAccept}
          onDismiss={onDismiss}
          onChangeItems={onChangeItems}
        />
      )}
    </div>
  );
}
