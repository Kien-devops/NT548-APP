# Bàn giao APP dùng PostgreSQL cho nhóm IaC

## Phần APP đã có

- Ba image backend đọc PostgreSQL, giữ nguyên API frontend.
- Migration trong `database/migrations/`: `001_products.sql`, `002_users.sql`, `003_orders.sql`.
- Container `database/Dockerfile` chạy initializer `init.js`: migration, role chỉ đọc và admin băm scrypt.
- Docker Compose local tự chạy init trước backend. ECS cần cấu hình một tác vụ migration riêng; deploy image backend không tự chạy Compose hoặc tạo bảng.
- Test User, Product, Order dùng mock DB. Test database tạo PostgreSQL tạm, kiểm tra dữ liệu/role/admin, chạy lại và rollback; không cần DB hoặc tài khoản AWS thật.

## Cấu hình từng backend trên ECS

| Biến | User | Product | Order |
|---|---|---|---|
| `PORT` | `5001` | `5002` | `5003` |
| `DB_HOST` | Endpoint PostgreSQL do IaC cung cấp | Cùng endpoint | Cùng endpoint |
| `DB_PORT` | `5432` | `5432` | `5432` |
| `DB_NAME` | `nt548` | `nt548` | `nt548` |
| `DB_USER` | `nt548_user` | `nt548_product` | `nt548_order` |
| `DB_PASSWORD` | Secret tương ứng `USER_DB_PASSWORD` | Secret tương ứng `PRODUCT_DB_PASSWORD` | Secret tương ứng `ORDER_DB_PASSWORD` |
| `JWT_SECRET` | Secret chung cho ba backend | Cùng secret | Cùng secret |

User có thể nhận thêm `TOKEN_TTL_SECONDS` (mặc định 3600). `NODE_ENV=production` dùng khi deploy Node.js. Frontend vẫn cần các biến upstream `USER_SERVICE_HOST/PORT`, `PRODUCT_SERVICE_HOST/PORT`, `ORDER_SERVICE_HOST/PORT` phù hợp với routing ECS/ALB.

Không đưa mật khẩu PostgreSQL quản trị vào các backend. ECS lấy mật khẩu ứng dụng qua Secrets Manager; `.env` của máy local không phải artifact triển khai. IAM execution role cần quyền đọc các secret được task definition tham chiếu. Network/security group phải cho phép backend và migration task tới DB qua 5432.

## Migration task trước khi dùng backend mới

Initializer hiện dành cho PostgreSQL local do tài khoản `postgres` quản trị. Các biến cần cung cấp cho tác vụ này:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: thông tin kết nối quản trị DB.
- `USER_DB_PASSWORD`, `PRODUCT_DB_PASSWORD`, `ORDER_DB_PASSWORD`: mật khẩu ba role ứng dụng, cùng giá trị với secret backend tương ứng.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: tài khoản admin lần đầu.

Nhóm cần chuẩn bị việc build/lưu image initializer và chạy task có quyền truy cập DB. Chỉ cho backend sử dụng bản mới khi migration task thành công. Script ghi checksum vào `schema_migrations`, không ghi đè dữ liệu/admin đã có; thay đổi schema bằng migration mới. Backend hiện chỉ có quyền SELECT, nên các API thêm/sửa/xóa cần phát triển và cấp quyền riêng nếu bổ sung sau này.

**Điểm phải chốt khi lên AWS:** các kết nối hiện chưa cấu hình TLS PostgreSQL (`ssl: false` ở Node.js; Python dùng mặc định psycopg). Initializer cũng dùng TLS tắt và lệnh role local có `NOSUPERUSER`/`NOREPLICATION`; cần điều chỉnh, kiểm thử với master role của RDS và chính sách TLS thực tế trước khi dùng trên RDS. File này mô tả phần đã làm và các chỗ cần phối hợp, không xác nhận bản local đã triển khai được trên AWS.

`ADMIN_PASSWORD` chỉ tạo admin lần đầu, không đổi mật khẩu đã lưu. `ADMIN_EMAIL`/`ADMIN_PASSWORD` không còn được User Backend dùng để xác thực trực tiếp.

## Kiểm tra APP trước khi đưa lên dev

```bash
npm ci --prefix be-user-service --omit=dev
npm ci --prefix be-order-service --omit=dev
pip install -r be-product-service/requirements.txt
bash scripts/test-service.sh user
bash scripts/test-service.sh product
bash scripts/test-service.sh order
bash scripts/test-service.sh frontend
bash scripts/test-service.sh database
```

Test database cần Docker daemon và Node.js, đã có trong CodeBuild đang dùng để build image. Runner tự tạo và dọn container/network/image tạm, không mở cổng DB ra host và không truy cập DB ứng dụng. Trên Windows, chạy các lệnh Bash bằng Git Bash; chạy local stack theo README.

Đưa thay đổi APP vào `dev` theo quy trình của nhóm. Push `dev` có thể kích hoạt pipeline và triển khai AWS; nhóm IaC cần hoàn thành cấu hình DB, Secrets, migration và smoke-test credentials để phần deploy đạt. Không commit `.env`, mật khẩu, JWT hoặc Terraform state.
