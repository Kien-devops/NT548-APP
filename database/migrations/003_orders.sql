CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(24) PRIMARY KEY,
    customer VARCHAR(120) NOT NULL,
    total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the existing API's demo orders; rerunning does not overwrite stored data.
INSERT INTO orders (order_id, customer, total, status)
VALUES
    ('ORD-9021', 'Nguyễn Văn A', 49.99, 'COMPLETED'),
    ('ORD-9022', 'Trần Thị B', 118.50, 'PROCESSING'),
    ('ORD-9023', 'Lê Văn C', 35.00, 'COMPLETED')
ON CONFLICT (order_id) DO NOTHING;
