-- 1. Create the character sheet table
CREATE TABLE charactersheets (
    id      SERIAL PRIMARY KEY,
    title   VARCHAR(100) NOT NULL,
    content TEXT            NOT NULL,
    created TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires TIMESTAMPTZ     NOT NULL
);

-- 2. Index on the created timestamp
CREATE INDEX idx_charactersheet_created
    ON charactersheets(created);

-- 3. Create the users table
CREATE TABLE users (
    id              SERIAL      PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    hashed_password CHAR(60)     NOT NULL,
    created         TIMESTAMPTZ  NOT NULL
);

-- 4. Seed a user record
INSERT INTO users (name, email, hashed_password, created) VALUES (
    'Alice Jones',
    'alice@example.com',
    '$2a$12$NuTjWXm3KKntReFwyBVHyuf/to.HEwTy.eS206TNfkGfr6HzGJSWG',
    TIMESTAMPTZ '2022-01-01 10:00:00+00'
);
