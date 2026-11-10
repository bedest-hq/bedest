-- Custom SQL migration file, put your code below! --
-- [FEAT-06] user_tokens is tenant data like the tables of 0004: the
-- schema owner is subject to its policy too. Table owners bypass RLS
-- unless it is forced. Default privileges (0004) already grant the
-- application role SELECT, INSERT, UPDATE, DELETE on new tables.
ALTER TABLE user_tokens FORCE ROW LEVEL SECURITY;
