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
| [database](./database) | PostgreSQL 16 / Node.js | 5432 (nội bộ Docker) | Migration, tài khoản DB và admin ban đầu |

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

## 5. Khởi chạy cục bộ với PostgreSQL

Yêu cầu Docker Desktop đang chạy Linux containers và Docker Compose. Không cần cài PostgreSQL hoặc Node.js trên máy để chạy stack.

**Bước 1 — Tạo `.env` lần đầu** tại thư mục gốc của repo (không ghi đè nếu đã có):

```powershell
Copy-Item .env.example .env
```

Trong `.env`, thay các giá trị `CHANGE_ME`, đặc biệt `POSTGRES_PASSWORD`, `USER_DB_PASSWORD`, `PRODUCT_DB_PASSWORD`, `ORDER_DB_PASSWORD`, `ADMIN_PASSWORD` và `JWT_SECRET` (chuỗi ngẫu nhiên ít nhất 32 ký tự). Chọn `ADMIN_EMAIL` cho admin ban đầu và đặt `APP_PORT=7979` nếu muốn dùng cổng 7979. Không commit `.env`; `.env.example` chỉ chứa giá trị mẫu.

**Bước 2 — Build và khởi động ứng dụng:**

```powershell
docker compose up --build -d frontend
```

Compose tự khởi động các dependency theo thứ tự: PostgreSQL healthy → `db-init` chạy thành công → ba backend → frontend. `db-init` chạy migration theo tên file, tạo ba tài khoản PostgreSQL và tạo admin với mật khẩu băm scrypt. MySQL còn trong Compose để tham khảo cấu hình cũ; lệnh trên không khởi động MySQL vì các backend local đều dùng PostgreSQL.

**Bước 3 — Kiểm tra và đăng nhập:**

```powershell
docker compose ps -a
docker compose logs db-init
```

`db-init` có trạng thái `Exited (0)` là bình thường: đây là tác vụ khởi tạo chạy một lần rồi thoát. Các service còn lại phải `healthy`. Mở `http://localhost:7979` (hoặc cổng `APP_PORT` của bạn), đăng nhập bằng admin đã tạo.

### Chạy lại migration và bảo toàn dữ liệu

```powershell
docker compose run --build --rm db-init
```

Script ghi phiên bản và checksum vào `schema_migrations`, bỏ qua migration đã chạy và không ghi đè sản phẩm, đơn hàng hoặc admin hiện có. Nếu cần đổi schema, thêm file mới như `004_order_items.sql`; không sửa migration đã áp dụng. Một lần chạy dùng transaction: lỗi sẽ rollback và backend sẽ không khởi động khi bước init thất bại.

Ba role `nt548_user`, `nt548_product`, `nt548_order` chỉ được `SELECT` trên bảng tương ứng `users`, `products`, `orders`. Script đồng bộ mật khẩu các role với các biến `*_DB_PASSWORD` mỗi lần chạy. Sau khi đổi mật khẩu role và chạy init, chạy lại `docker compose up -d frontend` để cập nhật môi trường backend.

`ADMIN_PASSWORD` chỉ tạo admin lần đầu: sửa biến này không đổi mật khẩu admin đã lưu. Tương tự, `POSTGRES_PASSWORD` của image PostgreSQL chỉ có tác dụng khởi tạo volume mới; đổi biến không tự đổi mật khẩu PostgreSQL đã có. Cấu hình này dành cho Docker local; triển khai AWS cần endpoint, TLS và Secrets riêng.

Volume PostgreSQL giữ dữ liệu qua các lần dừng/chạy. Không dùng `docker compose down -v` nếu muốn giữ dữ liệu.

### Kiểm thử DB và bàn giao cho IaC

Trong Git Bash/Linux, chạy `bash scripts/test-service.sh database` để kiểm thử initializer trên một PostgreSQL tạm riêng. Runner cần Docker đang chạy và Node.js; tự dọn container, network và image kiểm thử. Pipeline DEV/PROD gọi runner này khi database thay đổi.

Thông tin cấu hình backend, migration và các điểm cần phối hợp khi lên AWS nằm trong [bàn giao PostgreSQL cho IaC](docs/postgresql-handoff.md).
