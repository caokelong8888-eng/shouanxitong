-- ============================================================
-- 002_seed.sql  演示数据
-- ------------------------------------------------------------
-- 重点验证用例：
--   ① AA电池 分布在两个盒子（盒子02: 8节 / 盒子08: 12节）→ 验证多位置模型
--   ② HDMI线 在盒子03，数量 2        → 验证普通单位置物品
--   ③ 充电宝 借给家人A（无盒子）      → 验证 container_id 可为空的场景
-- ============================================================

-- ---------- 家庭 & 成员 ----------
INSERT INTO families (id, name) VALUES (1, '我的家');
INSERT INTO users (id, family_id, name, role) VALUES
  (1, 1, '曹总', 'owner'),
  (2, 1, '家人A', 'member'),
  (3, 1, '家人B', 'member');

-- ---------- 空间 ----------
INSERT INTO spaces (id, family_id, name, icon, sort_order) VALUES
  (1, 1, '客厅',   '🛋️', 1),
  (2, 1, '卧室',   '🛏️', 2),
  (3, 1, '书房',   '📚', 3),
  (4, 1, '厨房',   '🍳', 4),
  (5, 1, '储藏室', '📦', 5);

-- ---------- 区域 / 家具 ----------
INSERT INTO locations (id, family_id, space_id, name, sort_order) VALUES
  (1, 1, 1, '电视柜',  1),
  (2, 1, 2, '衣柜',    1),
  (3, 1, 2, '床头柜',  2),
  (4, 1, 3, '柜子A',   1),
  (5, 1, 5, '货架B',   1);

-- ---------- 收纳盒 ----------
INSERT INTO containers (id, family_id, space_id, location_id, code, name, detail, full_path, sort_order) VALUES
  (1, 1, 1, 1, 'B01', '盒子01', '第一层', '客厅 / 电视柜 / 第一层 / 盒子01', 1),
  (2, 1, 1, 1, 'B02', '盒子02', '第二层', '客厅 / 电视柜 / 第二层 / 盒子02', 2),
  (3, 1, 3, 4, 'B03', '盒子03', '第二层', '书房 / 柜子A / 第二层 / 盒子03', 3),
  (4, 1, 3, 4, 'B04', '盒子04', '第二层', '书房 / 柜子A / 第二层 / 盒子04', 4),
  (5, 1, 3, 4, 'B05', '盒子05', '第三层', '书房 / 柜子A / 第三层 / 盒子05', 5),
  (6, 1, 2, 2, 'B06', '盒子06', '上层',   '卧室 / 衣柜 / 上层 / 盒子06',     6),
  (7, 1, 2, 3, 'B07', '盒子07', NULL,     '卧室 / 床头柜 / 盒子07',          7),
  (8, 1, 5, 5, 'B08', '盒子08', '第一层', '储藏室 / 货架B / 第一层 / 盒子08', 8);

-- ---------- 分类 ----------
INSERT INTO categories (id, family_id, name, icon, is_system, sort_order) VALUES
  (1, 1, '电子配件', '🔌', 1, 1),
  (2, 1, '电池',     '🔋', 1, 2),
  (3, 1, '工具',     '🔧', 1, 3),
  (4, 1, '文具',     '✏️', 1, 4),
  (5, 1, '生活用品', '🧴', 1, 5),
  (6, 1, '待确认',   '❓', 1, 99);

-- ---------- 标签 ----------
INSERT INTO tags (id, family_id, name, color) VALUES
  (1, 1, 'USB-C',  '#3B82F6'),
  (2, 1, 'HDMI',   '#8B5CF6'),
  (3, 1, '数据线', '#06B6D4'),
  (4, 1, '充电',   '#F59E0B'),
  (5, 1, '电视',   '#10B981'),
  (6, 1, '显示器', '#6366F1');

-- ---------- 物品规格层（注意：这里没有 quantity / container_id） ----------
INSERT INTO items (id, family_id, name, category_id, description, brand, model, color, unit, status, ai_confidence, need_confirm, search_text) VALUES
  (1, 1, 'AA电池',              2, '5号碱性电池',              NULL,     NULL,     NULL,   '节', 'in_box', 0.95, 0, 'AA电池 5号 电池 碱性'),
  (2, 1, 'HDMI线',              1, '标准 HDMI 高清线，约 1.5 米', '绿联',   'HD104',  '黑色', '条', 'in_box', 0.92, 0, 'HDMI线 高清线 电视 显示器 绿联'),
  (3, 1, 'USB-C数据线',          1, 'Type-C 快充数据线',         NULL,     NULL,     '白色', '条', 'in_box', 0.90, 0, 'USB-C 数据线 充电 Type-C'),
  (4, 1, '六角扳手',             3, '内六角扳手套装',            NULL,     NULL,     '银色', '套', 'in_box', 0.88, 0, '六角扳手 内六角 工具'),
  (5, 1, '充电宝',               1, '20000mAh 移动电源',         NULL,     NULL,     '深灰', '个', 'lent',   0.93, 0, '充电宝 移动电源 电池'),
  (6, 1, 'AAA电池',              2, '7号碱性电池',              NULL,     NULL,     NULL,   '节', 'in_box', 0.94, 0, 'AAA电池 7号 电池'),
  (7, 1, 'USB-C 转 HDMI 转接器', 1, '可接电脑与显示器',          NULL,     NULL,     '银灰', '个', 'in_box', 0.91, 0, 'USB-C HDMI 转接器 转换头 电脑 显示器'),
  (8, 1, '未知零件',             6, '暂未确认用途',              NULL,     NULL,     NULL,   NULL, 'in_box', 0.35, 1, '未知零件 待确认');

-- ---------- 库存层（多位置核心） ----------
-- ① AA电池：盒子02 有 8 节，盒子08 有 12 节  ← 关键验证用例
-- ② HDMI线：盒子03 有 2 条
-- ③ 充电宝：无盒子（借给家人A），container_id = NULL
INSERT INTO stock (item_id, container_id, quantity, status, note) VALUES
  (1, 2, 8,  'in_box', NULL),
  (1, 8, 12, 'in_box', NULL),
  (2, 3, 2,  'in_box', NULL),
  (3, 3, 1,  'in_box', NULL),
  (4, 3, 1,  'in_box', NULL),
  (6, 3, 4,  'in_box', NULL),
  (7, 2, 1,  'in_box', NULL),
  (5, NULL, 1, 'lent', '借给家人A');

-- ---------- 物品标签 ----------
INSERT INTO item_tags (item_id, tag_id) VALUES
  (1, 4),
  (2, 2), (2, 5), (2, 6),
  (3, 1), (3, 3), (3, 4),
  (7, 1), (7, 2), (7, 6);

-- ---------- 操作日志（少量示例） ----------
INSERT INTO activity_logs (family_id, user_id, action, entity_type, entity_id, summary) VALUES
  (1, 1, 'create', 'container', 3, '创建了盒子03'),
  (1, 1, 'create', 'container', 4, '创建了盒子04'),
  (1, 1, 'create', 'container', 5, '创建了盒子05'),
  (1, 2, 'update', 'item', 5, '把充电宝借给了家人A');
