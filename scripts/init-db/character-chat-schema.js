'use strict';

async function ensureCharacterSchema(connection, helpers) {
  const { ensureColumn, ensureIndex } = helpers;
  console.log('[init-db] 初始化 characters 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id             BIGINT NOT NULL,
      name                VARCHAR(5000) NOT NULL,
      summary             VARCHAR(5000) NOT NULL,
      personality         TEXT NULL,
      first_message       TEXT NULL,
      prompt_profile_json JSON NULL,
      visibility          ENUM('public','private','unlisted') DEFAULT 'public',
      status              ENUM('draft','published','blocked') DEFAULT 'published',
      created_at          DATETIME NOT NULL,
      updated_at          DATETIME NOT NULL,
      avatar_image_path   VARCHAR(500) NULL,
      background_image_path VARCHAR(500) NULL,
      is_nsfw             TINYINT(1) NOT NULL DEFAULT 0,
      source_type         VARCHAR(40) NULL,
      source_format       VARCHAR(80) NULL,
      source_file_name    VARCHAR(255) NULL,
      source_file_hash    VARCHAR(64) NULL,
      source_card_json    JSON NULL,
      imported_world_book_json JSON NULL,
      flattened_world_book_text LONGTEXT NULL,
      import_batch_id     BIGINT NULL,
      CONSTRAINT fk_characters_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('characters', 'prompt_profile_json', 'prompt_profile_json JSON NULL');
  await connection.query('ALTER TABLE `characters` MODIFY COLUMN `name` VARCHAR(5000) NOT NULL');
  await connection.query('ALTER TABLE `characters` MODIFY COLUMN `summary` VARCHAR(5000) NOT NULL');
  await connection.query('ALTER TABLE `characters` MODIFY COLUMN `personality` TEXT NULL');
  await connection.query('ALTER TABLE `characters` MODIFY COLUMN `first_message` TEXT NULL');
  await ensureColumn('characters', 'avatar_image_path', 'avatar_image_path VARCHAR(500) NULL');
  await ensureColumn('characters', 'background_image_path', 'background_image_path VARCHAR(500) NULL');
  await ensureColumn('characters', 'visibility', "visibility ENUM('public','private','unlisted') DEFAULT 'public'");
  await ensureColumn('characters', 'status', "status ENUM('draft','published','blocked') NOT NULL DEFAULT 'published'");
  await ensureColumn('characters', 'is_nsfw', 'is_nsfw TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('characters', 'source_type', 'source_type VARCHAR(40) NULL');
  await ensureColumn('characters', 'source_format', 'source_format VARCHAR(80) NULL');
  await ensureColumn('characters', 'source_file_name', 'source_file_name VARCHAR(255) NULL');
  await ensureColumn('characters', 'source_file_hash', 'source_file_hash VARCHAR(64) NULL');
  await ensureColumn('characters', 'source_card_json', 'source_card_json JSON NULL');
  await ensureColumn('characters', 'imported_world_book_json', 'imported_world_book_json JSON NULL');
  await ensureColumn('characters', 'flattened_world_book_text', 'flattened_world_book_text LONGTEXT NULL');
  await ensureColumn('characters', 'import_batch_id', 'import_batch_id BIGINT NULL');
  await ensureIndex('characters', 'idx_characters_public_nsfw', '(visibility, status, is_nsfw, id)');
  await ensureIndex('characters', 'idx_characters_source_file_hash', '(source_file_hash)');

  await connection.query(`
    ALTER TABLE \`characters\`
    MODIFY COLUMN \`visibility\`
      ENUM('public','private','unlisted')
      NOT NULL DEFAULT 'public'
  `);
  await connection.query(`
    ALTER TABLE \`characters\`
    MODIFY COLUMN \`status\`
      ENUM('draft','published','blocked')
      NOT NULL DEFAULT 'published'
  `);
  console.log('[init-db]   ~ characters.visibility/status ENUM 已确认完整');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(32) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      description VARCHAR(255) NULL,
      color VARCHAR(32) NULL,
      icon VARCHAR(32) NULL,
      is_nsfw TINYINT(1) NOT NULL DEFAULT 0,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      usage_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uniq_tags_slug (slug),
      INDEX idx_tags_enabled_sort (is_enabled, sort_order, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_tags (
      character_id BIGINT NOT NULL,
      tag_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (character_id, tag_id),
      INDEX idx_character_tags_tag (tag_id, character_id),
      CONSTRAINT fk_character_tags_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      admin_user_id BIGINT NULL,
      total_count INT NOT NULL DEFAULT 0,
      success_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      options_json JSON NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_import_batches_created (created_at),
      CONSTRAINT fk_import_batches_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS import_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      batch_id BIGINT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_hash VARCHAR(64) NULL,
      status VARCHAR(30) NOT NULL,
      error_message TEXT NULL,
      parsed_role_name VARCHAR(100) NULL,
      created_role_id BIGINT NULL,
      raw_json JSON NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_import_items_batch (batch_id, id),
      CONSTRAINT fk_import_items_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      CONSTRAINT fk_import_items_character FOREIGN KEY (created_role_id) REFERENCES characters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('[init-db] 初始化 character_likes / comments / usage 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_likes (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY uniq_character_like_user (character_id, user_id),
      INDEX idx_character_likes_character (character_id),
      CONSTRAINT fk_character_likes_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      body VARCHAR(500) NOT NULL,
      status ENUM('visible','hidden','deleted') NOT NULL DEFAULT 'visible',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_character_comments_character (character_id, status, id),
      CONSTRAINT fk_character_comments_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_usage_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_character_usage_character (character_id),
      INDEX idx_character_usage_user (user_id, created_at),
      CONSTRAINT fk_character_usage_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureChatSchema(connection, helpers) {
  const { ensureColumn, ensureIndex } = helpers;
  console.log('[init-db] 初始化 conversations 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                       BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id                  BIGINT NOT NULL,
      character_id             BIGINT NOT NULL,
      parent_conversation_id   BIGINT NULL,
      branched_from_message_id BIGINT NULL,
      current_message_id       BIGINT NULL,
      selected_model_mode      VARCHAR(64) NOT NULL DEFAULT 'standard',
      title                    VARCHAR(200) NULL,
      status                   ENUM('active','archived','deleted') DEFAULT 'active',
      deleted_at               DATETIME NULL,
      last_message_at          DATETIME NULL,
      created_at               DATETIME NOT NULL,
      updated_at               DATETIME NOT NULL,
      CONSTRAINT fk_conversations_user      FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
      CONSTRAINT fk_conversations_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('conversations', 'parent_conversation_id',   'parent_conversation_id BIGINT NULL');
  await ensureColumn('conversations', 'branched_from_message_id', 'branched_from_message_id BIGINT NULL');
  await ensureColumn('conversations', 'current_message_id',       'current_message_id BIGINT NULL');
  await ensureColumn('conversations', 'selected_model_mode',      "selected_model_mode VARCHAR(64) NOT NULL DEFAULT 'standard'");
  await connection.query(`
    ALTER TABLE \`conversations\`
    MODIFY COLUMN \`selected_model_mode\` VARCHAR(64) NOT NULL DEFAULT 'standard'
  `);
  await ensureColumn('conversations', 'deleted_at',               'deleted_at DATETIME NULL');
  await ensureIndex('conversations', 'idx_conversations_parent',         '(parent_conversation_id)');
  await ensureIndex('conversations', 'idx_conversations_branch_message', '(branched_from_message_id)');
  await ensureIndex('conversations', 'idx_conversations_current_message','(current_message_id)');

  console.log('[init-db] 初始化 messages 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id                     BIGINT PRIMARY KEY AUTO_INCREMENT,
      conversation_id        BIGINT NOT NULL,
      sender_type            ENUM('user','character','system') NOT NULL,
      content                LONGTEXT NOT NULL,
      sequence_no            INT NOT NULL,
      parent_message_id      BIGINT NULL,
      branch_from_message_id BIGINT NULL,
      edited_from_message_id BIGINT NULL,
      prompt_kind            ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message') NOT NULL DEFAULT 'normal',
      metadata_json          JSON NULL,
      status                 ENUM('success','failed','streaming') DEFAULT 'success',
      deleted_at             DATETIME NULL,
      created_at             DATETIME NOT NULL,
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      INDEX idx_messages_conversation_sequence (conversation_id, sequence_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('messages', 'parent_message_id',      'parent_message_id BIGINT NULL');
  await ensureColumn('messages', 'branch_from_message_id', 'branch_from_message_id BIGINT NULL');
  await ensureColumn('messages', 'edited_from_message_id', 'edited_from_message_id BIGINT NULL');
  await ensureColumn('messages', 'prompt_kind',
    "prompt_kind ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message') NOT NULL DEFAULT 'normal'");
  await ensureColumn('messages', 'metadata_json', 'metadata_json JSON NULL');
  await ensureColumn('messages', 'deleted_at', 'deleted_at DATETIME NULL');
  await ensureIndex('messages', 'idx_messages_parent',      '(parent_message_id)');
  await ensureIndex('messages', 'idx_messages_branch_from', '(branch_from_message_id)');
  await ensureIndex('messages', 'idx_messages_edited_from', '(edited_from_message_id)');
  await connection.query(`
    ALTER TABLE \`messages\`
    MODIFY COLUMN \`prompt_kind\`
      ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message')
      NOT NULL DEFAULT 'normal'
  `);
  console.log('[init-db]   ~ messages.prompt_kind ENUM 已确认完整');
}

module.exports = {
  ensureCharacterSchema,
  ensureChatSchema,
};
