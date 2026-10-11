CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO products (id, name, category, price)
VALUES
    (101, 'AWS Fargate Cluster v2', 'Cloud Computing', 49.99),
    (102, 'Terraform Enterprise Blueprint', 'DevOps Tools', 89.00),
    (103, 'Docker & Kubernetes Master', 'Containerization', 29.50),
    (104, 'Prometheus & Grafana', 'Observability', 35.00)
ON CONFLICT (id) DO NOTHING;