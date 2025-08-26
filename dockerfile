# ---- builder ----
FROM golang:1.24-alpine AS builder
RUN apk add --no-cache git build-base

WORKDIR /src

# cache modules
COPY go.mod go.sum ./
RUN go mod download

# copy all source
COPY . .

# build binary (adjust module path if needed)
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/web

# ---- final image ----
FROM alpine:3.18
RUN apk add --no-cache ca-certificates

# create non-root user for security
RUN addgroup -S app && adduser -S -G app app

WORKDIR /home/app
COPY --from=builder /app/server /home/app/server
RUN chown -R app:app /home/app

USER app
ENV PORT=4000
EXPOSE 4000

# Default: pass DSN via cli flag (-dsn)
ENTRYPOINT ["./server"]
