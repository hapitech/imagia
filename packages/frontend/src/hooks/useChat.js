import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getConversations,
  createConversation,
  getMessages,
  sendMessage as apiSendMessage,
  addSecret,
  getProjectSecrets,
  uploadFiles as apiUploadFiles,
} from '../services/api';

/**
 * Custom hook that encapsulates all chat state and operations for a project.
 *
 * Handles:
 * - Loading / creating the default conversation on mount
 * - Fetching existing messages
 * - Sending new messages (with optimistic UI updates)
 * - Detected secrets flow (pause, collect values, save, retry)
 * - Refreshing messages from the server
 * - Polling fallback when SSE drops
 *
 * @param {string} projectId - UUID of the current project
 */
export default function useChat(projectId) {
  // ---- State ------------------------------------------------------------------
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [detectedSecrets, setDetectedSecrets] = useState(null);
  const [error, setError] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // Keep a ref to the latest pending message so the secrets flow can retry it.
  const pendingMessageRef = useRef(null);
  const pendingAttachmentIdsRef = useRef([]);

  // Polling fallback refs
  const pollingRef = useRef(null);
  const conversationIdRef = useRef(null);

  // Keep conversationId ref in sync for use in polling interval
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ---- Polling fallback helper ------------------------------------------------
  // Starts polling every 3s after a message is sent. Stops when the LAST message
  // in the conversation is an assistant message (meaning the current build has
  // completed and stored its response). Also stops when SSE triggers
  // refreshMessages, or after 5 minutes. Uses refs to avoid dependency on
  // reactive state.
  function startResponsePolling() {
    if (pollingRef.current) clearInterval(pollingRef.current);

    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    const MAX_POLL_TIME = 5 * 60 * 1000;

    pollingRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      const convId = conversationIdRef.current;
      if (elapsed > MAX_POLL_TIME || !convId) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        return;
      }

      try {
        const msgsResponse = await getMessages(convId);
        const msgList = Array.isArray(msgsResponse)
          ? msgsResponse
          : msgsResponse.messages || [];

        // The build is done when the LAST message is from the assistant.
        // This avoids false positives from old unfetched assistant messages
        // that accumulated from previous builds where SSE dropped.
        const lastMsg = msgList[msgList.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          setMessages(msgList);
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch {
        // Silently retry on next interval
      }
    }, POLL_INTERVAL);
  }

  // ---- Bootstrap conversation on mount ----------------------------------------
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function bootstrap() {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch existing conversations for this project
        const convosResponse = await getConversations(projectId);
        const convoList = Array.isArray(convosResponse)
          ? convosResponse
          : convosResponse.conversations || [];

        let convoId;

        if (convoList.length > 0) {
          // Use the most recent conversation
          convoId = convoList[0].id;
        } else {
          // Create a default conversation
          const created = await createConversation({ project_id: projectId });
          const convo = created.conversation || created;
          convoId = convo.id;
        }

        if (cancelled) return;
        setConversationId(convoId);

        // Fetch messages for the conversation
        const msgsResponse = await getMessages(convoId);
        const msgList = Array.isArray(msgsResponse)
          ? msgsResponse
          : msgsResponse.messages || [];

        if (!cancelled) {
          setMessages(msgList);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('useChat: failed to bootstrap conversation', err);
          setError(err.message || 'Failed to load conversation');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ---- Attachment management ---------------------------------------------------
  const addAttachments = useCallback((files) => {
    const fileArray = Array.from(files);
    setPendingAttachments((prev) => [...prev, ...fileArray]);
  }, []);

  const removeAttachment = useCallback((index) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  // ---- Send a message ---------------------------------------------------------
  const sendMessage = useCallback(
    async (content, secrets, selectedModel) => {
      if (!conversationId || !content.trim()) {
        return null;
      }

      // Optimistic: add user bubble with attachment previews
      const optimisticAttachments = pendingAttachments.map((f) => ({
        id: `temp-att-${Date.now()}-${Math.random()}`,
        filename: f.name,
        mime_type: f.type,
        file_size: f.size,
        category: f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'video',
        _localUrl: URL.createObjectURL(f),
      }));

      const optimisticMsg = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        attachments: optimisticAttachments,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setIsSending(true);
      setError(null);

      try {
        // Upload pending attachments first
        let attachmentIds = [];
        if (pendingAttachments.length > 0) {
          setIsUploading(true);
          const uploadResponse = await apiUploadFiles(projectId, pendingAttachments);
          attachmentIds = (uploadResponse.attachments || []).map((a) => a.id);
          setIsUploading(false);
        }

        // Clear pending attachments
        setPendingAttachments([]);

        const payload = { content };
        if (selectedModel) {
          payload.model = selectedModel;
        }
        if (secrets && secrets.length > 0) {
          payload.secrets = secrets;
        }
        if (attachmentIds.length > 0) {
          payload.attachment_ids = attachmentIds;
        }

        const response = await apiSendMessage(conversationId, payload);

        // If URLs were extracted, update the optimistic message with extraction info
        if (response.extracted_urls && response.extracted_urls.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimisticMsg.id
                ? { ...m, extracted_urls: response.extracted_urls }
                : m
            )
          );
        }

        // If the server detected missing secrets, pause and surface them
        if (response.detected_secrets && response.detected_secrets.length > 0) {
          setDetectedSecrets(response.detected_secrets);
          pendingMessageRef.current = content;
          pendingAttachmentIdsRef.current = attachmentIds;
          setIsSending(false);
          return null;
        }

        // Clear any previously detected secrets
        setDetectedSecrets(null);
        pendingMessageRef.current = null;
        pendingAttachmentIdsRef.current = [];

        // Start polling fallback for assistant response (in case SSE drops).
        // Polling checks if the last message is from the assistant.
        startResponsePolling();

        return response.job_id || null;
      } catch (err) {
        console.error('useChat: sendMessage failed', err);
        setIsUploading(false);
        setError(err.message || 'Failed to send message');

        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
            created_at: new Date().toISOString(),
            metadata: { error: true },
          },
        ]);

        return null;
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, projectId, pendingAttachments],
  );

  // ---- Save secrets then retry the pending message ----------------------------
  const saveSecretsAndRetry = useCallback(
    async (secretEntries) => {
      if (!projectId || !detectedSecrets) return null;

      setIsSending(true);
      setError(null);

      try {
        // Persist each secret
        for (const entry of secretEntries) {
          if (entry.key && entry.value) {
            await addSecret(projectId, {
              key: entry.key,
              value: entry.value,
              type: entry.type || 'api_key',
            });
          }
        }

        // Clear the secrets prompt
        setDetectedSecrets(null);

        // Re-send the original message (this time secrets exist on the server)
        const originalContent = pendingMessageRef.current;
        const attachmentIds = pendingAttachmentIdsRef.current;
        pendingMessageRef.current = null;
        pendingAttachmentIdsRef.current = [];

        if (originalContent && conversationId) {
          const payload = { content: originalContent };
          if (attachmentIds.length > 0) {
            payload.attachment_ids = attachmentIds;
          }
          const response = await apiSendMessage(conversationId, payload);

          // If somehow more secrets are needed, surface again
          if (response.detected_secrets && response.detected_secrets.length > 0) {
            setDetectedSecrets(response.detected_secrets);
            pendingMessageRef.current = originalContent;
            setIsSending(false);
            return null;
          }

          return response.job_id || null;
        }

        return null;
      } catch (err) {
        console.error('useChat: saveSecretsAndRetry failed', err);
        setError(err.message || 'Failed to save secrets');
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [projectId, conversationId, detectedSecrets],
  );

  // ---- Refresh messages from the server ---------------------------------------
  const refreshMessages = useCallback(async () => {
    if (!conversationId) return;

    try {
      const msgsResponse = await getMessages(conversationId);
      const msgList = Array.isArray(msgsResponse)
        ? msgsResponse
        : msgsResponse.messages || [];
      setMessages(msgList);

      // Stop polling — SSE-triggered refresh succeeded
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } catch (err) {
      console.error('useChat: refreshMessages failed', err);
    }
  }, [conversationId]);

  // ---- Dismiss detected secrets (user cancels) --------------------------------
  const dismissSecrets = useCallback(() => {
    setDetectedSecrets(null);
    pendingMessageRef.current = null;
  }, []);

  // ---- Public API -------------------------------------------------------------
  return {
    messages,
    conversationId,
    isLoading,
    isSending,
    isUploading,
    detectedSecrets,
    pendingAttachments,
    error,
    sendMessage,
    saveSecretsAndRetry,
    refreshMessages,
    dismissSecrets,
    addAttachments,
    removeAttachment,
    clearAttachments,
  };
}
