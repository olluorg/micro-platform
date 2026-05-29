# Build stage
FROM rust:1-bookworm AS builder
WORKDIR /build
COPY . .
RUN cargo build --release --bin ollu-server

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/target/release/ollu-server /app/ollu-server
COPY --from=builder /build/migrations /app/migrations
ENV DATABASE_URL=sqlite:///data/ollu.db
ENV BIND=0.0.0.0:8080
VOLUME ["/data"]
EXPOSE 8080
CMD ["/app/ollu-server"]
