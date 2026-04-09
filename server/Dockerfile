FROM rust:1-bookworm

WORKDIR /app

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

CMD ["cargo", "run"]
