FROM nginx:alpine

RUN apk update && apk upgrade --no-cache

ENV ENVIRONMENT=local \
    USER_SERVICE_HOST=be-user-service \
    USER_SERVICE_PORT=5001 \
    PRODUCT_SERVICE_HOST=be-product-service \
    PRODUCT_SERVICE_PORT=5002 \
    ORDER_SERVICE_HOST=be-order-service \
    ORDER_SERVICE_PORT=5003 \
    NGINX_ENVSUBST_FILTER="^(ENVIRONMENT|USER_SERVICE_HOST|USER_SERVICE_PORT|PRODUCT_SERVICE_HOST|PRODUCT_SERVICE_PORT|ORDER_SERVICE_HOST|ORDER_SERVICE_PORT)$"

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY src/ /usr/share/nginx/html/

# Validate the rendered configuration during the image build. Restricting
# envsubst to the uppercase deployment variables preserves native nginx
# variables such as $user_host, $host and $remote_addr.
RUN envsubst '${ENVIRONMENT} ${USER_SERVICE_HOST} ${USER_SERVICE_PORT} ${PRODUCT_SERVICE_HOST} ${PRODUCT_SERVICE_PORT} ${ORDER_SERVICE_HOST} ${ORDER_SERVICE_PORT}' \
      < /etc/nginx/templates/default.conf.template \
      > /etc/nginx/conf.d/default.conf \
    && nginx -t \
    && rm -f /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
