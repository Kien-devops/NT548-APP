-- NT548 - MySQL 8.x test schema and seed data
--
-- Import this file into the database selected by DB_NAME (default: nt548).
-- The script is idempotent: it can be executed again without deleting data.
--
-- Important: the current backend services still read demo data from memory.
-- This schema prepares MySQL data for the next step of connecting each service
-- to the database; importing it alone does not change API responses yet.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL COMMENT 'Reserved for database-backed authentication',
    role ENUM('ADMIN', 'CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
    id INT UNSIGNED NOT NULL,
    name VARCHAR(180) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price DECIMAL(12, 2) UNSIGNED NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_products_category_active (category, is_active),
    CONSTRAINT chk_products_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(24) NOT NULL,
    user_id VARCHAR(36) NULL,
    customer VARCHAR(120) NOT NULL,
    total DECIMAL(12, 2) UNSIGNED NOT NULL,
    status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id),
    KEY idx_orders_user (user_id),
    KEY idx_orders_status_created (status, created_at),
    CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_orders_total CHECK (total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id VARCHAR(24) NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    unit_price DECIMAL(12, 2) UNSIGNED NOT NULL,
    line_total DECIMAL(12, 2)
        GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_order_items_order_product (order_id, product_id),
    KEY idx_order_items_product (product_id),
    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_id) REFERENCES products (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_items_unit_price CHECK (unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO users (id, name, email, password_hash, role, is_active)
VALUES
    ('usr_admin_001', 'NT548 Administrator', 'admin@nt548.local', NULL, 'ADMIN', TRUE),
    ('usr_customer_001', 'Nguyễn Văn A', 'vana@uit.edu.vn', NULL, 'CUSTOMER', TRUE),
    ('usr_customer_002', 'Trần Thị B', 'thib@uit.edu.vn', NULL, 'CUSTOMER', TRUE),
    ('usr_customer_003', 'Lê Văn C', 'vanc@uit.edu.vn', NULL, 'CUSTOMER', TRUE)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    email = VALUES(email),
    role = VALUES(role),
    is_active = VALUES(is_active);

INSERT INTO products (id, name, category, price, is_active)
VALUES
    (101, 'AWS Fargate Cluster v2', 'Cloud Computing', 49.99, TRUE),
    (102, 'Terraform Enterprise Blueprint', 'DevOps Tools', 89.00, TRUE),
    (103, 'Docker & Kubernetes Master', 'Containerization', 29.50, TRUE),
    (104, 'Prometheus & Grafana', 'Observability', 35.00, TRUE)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    category = VALUES(category),
    price = VALUES(price),
    is_active = VALUES(is_active);

INSERT INTO orders (order_id, user_id, customer, total, status)
VALUES
    ('ORD-9021', 'usr_customer_001', 'Nguyễn Văn A', 49.99, 'COMPLETED'),
    ('ORD-9022', 'usr_customer_002', 'Trần Thị B', 118.50, 'PROCESSING'),
    ('ORD-9023', 'usr_customer_003', 'Lê Văn C', 35.00, 'COMPLETED')
ON DUPLICATE KEY UPDATE
    user_id = VALUES(user_id),
    customer = VALUES(customer),
    total = VALUES(total),
    status = VALUES(status);

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES
    ('ORD-9021', 101, 1, 49.99),
    ('ORD-9022', 102, 1, 89.00),
    ('ORD-9022', 103, 1, 29.50),
    ('ORD-9023', 104, 1, 35.00)
ON DUPLICATE KEY UPDATE
    quantity = VALUES(quantity),
    unit_price = VALUES(unit_price);

-- Quick verification queries. These result sets are shown after importing.
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items;

SELECT
    o.order_id,
    o.customer,
    o.status,
    o.total AS stored_total,
    SUM(oi.line_total) AS calculated_total
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.customer, o.status, o.total
ORDER BY o.order_id;
