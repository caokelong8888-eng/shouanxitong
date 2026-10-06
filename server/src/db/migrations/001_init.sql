-- ============================================================
-- 001_init.sql  家庭智能收纳管理系统 · 初始表结构
-- ------------------------------------------------------------
-- 设计要点（务必遵守，后续阶段不要破坏）：
--   1. 层级：families → spaces → locations → containers → items
--      locations/space_id 允许为空，层级不要求层层必填
--   2. containers 冗余保存 full_path（路径缓存），盒子移动时只改自己一行，
--      里面的物品通过 stock.container_id 自动跟随
--   3. 【多位置核心】同类物品可分布在多个盒子：
--      items   = 物品规格层（名称/分类/标签/状态），绝不存 quantity、container_id
--      stock   = 库存层（某容器里有多少），数量只在这里
--   4. 时间统一用 TEXT（ISO8601 本地时间），便于后续迁 MySQL 时映射 DATETIME
-- ============================================================

-- ---------- 家庭 ----------
CREATE TABLE IF NOT EXISTS families (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 家庭成员（第一版仅记录谁操作，不做权限） ----------
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'member',   -- 预留: owner / member
  avatar_url  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id);

-- ---------- 空间（客厅 / 卧室 / 书房） ----------
CREATE TABLE IF NOT EXISTS spaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_spaces_family ON spaces(family_id);

-- ---------- 区域 / 家具（电视柜 / 柜子A） ----------
-- space_id 允许为空：可以只建区域不归属空间
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  space_id    INTEGER REFERENCES spaces(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_locations_family ON locations(family_id);
CREATE INDEX IF NOT EXISTS idx_locations_space  ON locations(space_id);

-- ---------- 容器 / 收纳盒（唯一可挂物品的物理终点） ----------
-- code 是扫码键，全局唯一，例如 B01 / B02
-- space_id / location_id 允许为空：可以先建盒子，之后再归位
-- full_path 是路径缓存，例如「书房 / 柜子A / 第二层 / 盒子03」
CREATE TABLE IF NOT EXISTS containers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  space_id        INTEGER REFERENCES spaces(id)    ON DELETE SET NULL,
  location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  detail          TEXT,                          -- 更细的位置描述，如「第二层」
  note            TEXT,
  cover_image_id  INTEGER,                       -- 指向 item_images.id（软引用，避免循环外键）
  qrcode_path     TEXT,                          -- 生成的二维码图片相对路径
  full_path       TEXT,                          -- 路径缓存，由 service 层统一重算
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_containers_code   ON containers(code);
CREATE INDEX IF NOT EXISTS idx_containers_family        ON containers(family_id);
CREATE INDEX IF NOT EXISTS idx_containers_space         ON containers(space_id);
CREATE INDEX IF NOT EXISTS idx_containers_location      ON containers(location_id);

-- ---------- 分类（支持父子层级） ----------
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  icon        TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,   -- 1 = 系统预置分类，不允许删除
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_categories_family ON categories(family_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- ---------- 物品规格层 ----------
-- 【重要】这里不存 quantity，也不存 container_id —— 数量与位置都在 stock 表
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description     TEXT,
  brand           TEXT,
  model           TEXT,
  color           TEXT,
  unit            TEXT,                              -- 节 / 个 / 瓶 / 条
  status          TEXT    NOT NULL DEFAULT 'in_box', -- 见下方状态枚举
  cover_image_id  INTEGER,
  ai_confidence   REAL,                              -- AI 识别置信度，人工修改后保留原始值
  need_confirm    INTEGER NOT NULL DEFAULT 0,        -- 1 = AI 不确定，待人工确认
  search_text     TEXT,                              -- 归一化冗余检索字段：名称+品牌+型号+标签
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
-- 状态枚举 in_box|in_use|temp|lent|in_car|discarded|given_away
CREATE INDEX IF NOT EXISTS idx_items_family   ON items(family_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_status   ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_name     ON items(name);

-- ---------- 库存层（多位置核心） ----------
-- 一个 item 可以有多条 stock：盒子02 放 8 节、盒子08 放 12 节
-- container_id 允许为空：表示「不在任何盒子里」（如在家使用中、借出）
CREATE TABLE IF NOT EXISTS stock (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  container_id  INTEGER REFERENCES containers(id) ON DELETE CASCADE,
  quantity      REAL    NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL DEFAULT 'in_box',
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stock_item      ON stock(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_container ON stock(container_id);
-- 同一物品在同一盒子里只应有一条记录。
-- 注意：SQLite 唯一约束对 NULL 不生效，所以必须用「部分唯一索引」排除 NULL，
-- 否则「在家使用」这类无盒子记录会出现重复行。应用层另有兜底。
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_item_container
  ON stock(item_id, container_id) WHERE container_id IS NOT NULL;

-- ---------- 图片（物品照 + 盒子照共用） ----------
CREATE TABLE IF NOT EXISTS item_images (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER REFERENCES items(id)      ON DELETE CASCADE,
  container_id    INTEGER REFERENCES containers(id) ON DELETE CASCADE,
  original_path   TEXT    NOT NULL,   -- 相对 storage 根的路径
  thumb_path      TEXT,
  url             TEXT,               -- 访问地址（本地 /files/... 或 COS CDN 地址）
  thumb_url       TEXT,
  storage_driver  TEXT    NOT NULL DEFAULT 'local',  -- local | cos
  width           INTEGER,
  height          INTEGER,
  mime            TEXT,
  size            INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_images_item      ON item_images(item_id);
CREATE INDEX IF NOT EXISTS idx_images_container ON item_images(container_id);

-- ---------- 标签 ----------
CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  color       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_family_name ON tags(family_id, name);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

-- ---------- 操作日志 ----------
CREATE TABLE IF NOT EXISTS activity_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,   -- create|update|move|delete|scan|ai_recognize|inbound
  entity_type  TEXT    NOT NULL,   -- item|container|stock|space|location|category
  entity_id    INTEGER,
  summary      TEXT,               -- 人话描述，直接展示给用户
  detail       TEXT,               -- JSON 字符串
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_family_time ON activity_logs(family_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_entity      ON activity_logs(entity_type, entity_id);
