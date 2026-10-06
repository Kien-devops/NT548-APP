# NT548-APP — Microservices Application Codebase

Kho chứa mã nguồn của các microservices trong hệ thống **NT548**, được triển khai trên **Amazon ECS Fargate** qua CI/CD Pipelines tự động.

Hạ tầng nền tảng (VPC, ALB, ECS Cluster, ECR Repositories, IAM Roles, Pipelines) được quản lý riêng biệt tại repository hạ tầng: [NT548 (Infra)](https://github.com/Jonnysilverfang/NT548).

---

## 1. Cấu trúc Microservices

| Service | Runtime / Công nghệ | Port | Chức năng chính |
|---|---|---:|---|
| [frontend](./frontend) | Nginx SPA | 80 | Giao diện điều khiển (Console), Health check, Reverse proxy |
| [be-user-service](./be-user-service) | Node.js / Express | 5001 | Xác thực người dùng, băm mật khẩu bảo mật (Scrypt), cấp phát JWT |
| [be-product-service](./be-product-service) | Python / Flask | 5002 | API quản lý danh mục sản phẩm (yêu cầu JWT Bearer token) |
| [be-order-service](./be-order-service) | Node.js / Express | 5003 | API quản lý đơn hàng (yêu cầu JWT Bearer token) |
| [database](./database) | SQL Migrations | 3306 | Script khởi tạo schema cơ sở dữ liệu |

---

## 2. CI/CD Flow

Hệ thống CI/CD được kết nối tự động với AWS CodePipeline thông qua AWS CodeConnections:

### Nhánh `dev` (Ephemeral Testing)
1. Push code lên nhánh `dev`.
2. Chạy Unit test + Syntax compile check.
3. Build Docker images cho 4 services với tag bất biến (`Commit SHA`).
4. Push lên Amazon ECR DEV repositories.
5. **AWS Lambda Security Gate** kiểm tra kết quả ECR Scan: bắt buộc `CRITICAL = 0` và `HIGH = 0`.
6. Khởi tạo ECS Service tạm thời (ephemeral) gắn vào ALB với **Cookie-based routing** (`Cookie: nt548-test=true`).
7. Chạy bộ API Smoke test tự động.
8. Tự động thu hồi và dọn dẹp tài nguyên test (cleanup).

### Nhánh `main` (Production Rolling Deployment)
1. Push / Merge code vào nhánh `main`.
2. Chạy Unit test + Build 4 Docker images với tag Commit SHA.
3. Push lên Amazon ECR PROD repositories.
4. Quét bảo mật ECR Vulnerability Scan (`CRITICAL = 0, HIGH = 0`).
5. **Production Approval Gate**: Thông báo SNS và chờ phê duyệt.
6. Sau khi phê duyệt, AWS CodePipeline thực hiện **ECS Rolling Deployment** cập nhật đồng thời 4 microservices lên ECS Fargate mà không gây gián đoạn dịch vụ (Zero downtime).

---

## 3. Khởi chạy thử nghiệm cục bộ (Local Development)

Yêu cầu Docker và Docker Compose:

```bash
# 1. Sao chép biến môi trường
cp .env.example .env

# 2. Khởi động toàn bộ stack microservices
docker compose up -d

# 3. Kiểm tra trạng thái
docker compose ps
```

Truy cập giao diện tại: `http://localhost:8080` (hoặc cổng cấu hình trong `.env`).
