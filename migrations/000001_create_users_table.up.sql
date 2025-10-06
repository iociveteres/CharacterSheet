CREATE TABLE users (
    id              INT  primary key GENERATED ALWAYS AS IDENTITY,
    name            VARCHAR(255)   NOT NULL,
    email           VARCHAR(255)   NOT NULL UNIQUE,
    hashed_password CHAR(60)       NOT NULL,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP
);