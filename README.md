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

---

## 2. Kiến trúc CI/CD Tối ưu (Monorepo Change Detection & Reusable Components)

Ứng dụng monorepo được áp dụng kỹ thuật **Git-based Change Detection** nhằm tách biệt hoàn toàn logic build/test giữa các microservices, tránh build lại toàn bộ hệ thống khi chỉ có một service thay đổi:

### Các thành phần CI/CD tái sử dụng (`scripts/`)
- `scripts/detect-changes.sh`: Phân tích Git diff giữa commit hiện tại và revision trước đó. Xác định chính xác service nào đã thay đổi (`FRONTEND_CHANGED`, `USER_CHANGED`, `PRODUCT_CHANGED`, `ORDER_CHANGED`, `DATABASE_CHANGED`, `DOCS_ONLY`).
- `scripts/test-service.sh <service>`: Runner kiểm thử độc lập cho từng service (syntax check, mocha/jest, unittest).
- `scripts/build-service.sh <service> <tag> <env>`: Builder Docker chuẩn hóa, gắn tag commit SHA bất biến.
- `scripts/push-image.sh <service> <tag> <env>`: Cơ chế đẩy image lên ECR an toàn và idempotent (kiểm tra tồn tại trước khi push để tương thích với ECR Tag Immutability).
- `scripts/check-service-scan.sh <service> <tag> <env>`: Kiểm tra quét lỗ hổng ECR tự động cho từng service, chặn pipeline nếu xuất hiện lỗ hổng `CRITICAL > 0` hoặc `HIGH > 0`.
- `scripts/generate-imagedefinitions.sh`: Tạo file `imagedefinitions-<service>.json`. Service có thay đổi sẽ nhận image tag mới; service không thay đổi sẽ truy vấn và giữ nguyên image URI đang chạy trên ECS Fargate, đảm bảo tính idempotent của rolling deploy.

---

## 3. Luồng Pipeline DEV và PROD

### Nhánh `dev` (Ephemeral Testing with Change Detection)
1. Push code lên nhánh `dev`.
2. **Change Detection**: Nhận diện các service bị chỉnh sửa.
3. **Selective Testing**: Chỉ chạy unit tests cho các service có thay đổi (bỏ qua service không đổi).
4. **Selective Build & Push**: Chỉ build và push Docker image lên DEV ECR cho service thay đổi.
5. **Security Gate**: Lambda Security Gate tự động duyệt pipeline khi tất cả các image được build đạt tiêu chuẩn `CRITICAL=0, HIGH=0`.
6. **Selective Ephemeral Deployment**: Chỉ triển khai các service thay đổi lên ECS Fargate tạm thời và gắn routing rule trên ALB (`Cookie: nt548-test=true`). Các service không đổi sẽ tự động fallback về service PROD đang chạy ổn định.
7. **Smoke Testing**: Kiểm thử tích hợp thông qua cookie header.
8. **Guaranteed Cleanup**: Tự động dọn dẹp toàn bộ tài nguyên tạm thời.

### Nhánh `main` (Production Rolling Deployment with Change Detection)
1. Push / Merge code vào nhánh `main`.
2. **Change Detection**: Nhận diện thay đổi.
3. **Selective Testing & Build**: Chỉ test, build và push image mới cho các service thay đổi.
4. **Selective ECR Vulnerability Scan**: Kiểm tra kết quả quét bảo mật cho image mới.
5. **Production Approval Gate**: Gửi email qua SNS kèm tóm tắt scan để quản trị viên phê duyệt.
6. **Idempotent Rolling Deployment**: Tạo artifacts `imagedefinitions` cho cả 4 services (service thay đổi dùng tag mới, service giữ nguyên dùng tag hiện tại). CodePipeline thực hiện ECS rolling deployment mà không gây downtime.

---

## 4. Các kịch bản thực tế (Scenarios)

| Kịch bản | Thay đổi | Kết quả nhận diện | Hành vi Pipeline |
|---|---|---|---|
| **Scenario A** | Sửa `be-product-service/app.py` | `product: true`, còn lại: `false` | Chỉ test/build/scan/deploy product service. Bỏ qua frontend, user, order. |
| **Scenario B** | Chỉ sửa `README.md` | `docsOnly: true` | Bỏ qua toàn bộ test, build và deployment. |
| **Scenario C** | Sửa script CI/CD (`scripts/test-service.sh`) | `sharedChanged: true` (tất cả: `true`) | Tự động test và validate toàn bộ 4 services để đảm bảo an toàn. |
| **Scenario D** | Sửa frontend (`frontend/src/app.js`) | `frontend: true`, còn lại: `false` | Chỉ test/build/scan/deploy frontend Nginx SPA. |

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
