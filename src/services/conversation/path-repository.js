/**
 * @file src/services/conversation/path-repository.js
 * @description 使用递归查询读取当前会话从叶子消息到根消息的显示链。
 */

const { query } = require('../../lib/db');
const { normalizeMessageForView } = require('./message-view');

async function fetchPathMessages(conversationId, leafMessageId) {
  const normalizedLeafId = Number(leafMessageId || 0);
  if (!normalizedLeafId) return [];

  const rows = await query(
    `WITH RECURSIVE message_path AS (
       SELECT id,
              conversation_id,
              sender_type,
              content,
              sequence_no,
              status,
              created_at,
              parent_message_id,
              branch_from_message_id,
              edited_from_message_id,
              prompt_kind,
              metadata_json,
              deleted_at,
              0 AS reverse_depth
       FROM messages
       WHERE conversation_id = ? AND id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT m.id,
              m.conversation_id,
              m.sender_type,
              m.content,
              m.sequence_no,
              m.status,
              m.created_at,
              m.parent_message_id,
              m.branch_from_message_id,
              m.edited_from_message_id,
              m.prompt_kind,
              m.metadata_json,
              m.deleted_at,
              mp.reverse_depth + 1 AS reverse_depth
       FROM messages m
       JOIN message_path mp ON m.id = mp.parent_message_id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL
     )
     SELECT id,
            conversation_id,
            sender_type,
            content,
            sequence_no,
            status,
            created_at,
            parent_message_id,
            branch_from_message_id,
            edited_from_message_id,
            prompt_kind,
            metadata_json,
            deleted_at
     FROM message_path
     ORDER BY reverse_depth DESC`,
    [conversationId, normalizedLeafId, conversationId],
  );

  return rows.map(normalizeMessageForView);
}

module.exports = { fetchPathMessages };
