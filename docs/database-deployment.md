# Production Database Deployment & Migration Guide

This guide describes how to provision, configure, and migrate a fresh PostgreSQL database for production deployment of the Task Manager Platform.

---

## 1. Prerequisites & Overview

- **Database Engine**: PostgreSQL 13+ (PostgreSQL 14, 15, or 16 recommended).
- **ORM**: TypeORM v1.1.2.
- **Initial State**: The initial migration (`1771360000000-InitialDatabaseSchema.ts`) is designed exclusively for a **new and initially empty** PostgreSQL database.

> [!IMPORTANT]
> **Do not run the initial migration directly on an existing development database that was populated via `synchronize: true`.**
> The development database already contains tables created by automatic synchronization, but lacks a TypeORM `migrations` history table. Running this initial migration directly on that database will cause table/type creation conflicts. If you wish to adopt migration tracking on an existing populated database in the future, follow the [Adopting Migration Tracking on Existing Databases](#8-adopting-migration-tracking-on-existing-databases) baseline procedure below.

---

## 2. Environment Variables & Configuration

The application and TypeORM CLI read standard database configuration from environment variables. In production, provide these via your hosting platform's secret manager (e.g., Docker environment variables, Kubernetes Secrets, AWS Secrets Manager / Parameter Store, Railway, Heroku Config Vars, etc.). **Never commit credentials or `.env` files into source control.**

### Required Variables

| Variable      | Type   | Example / Default   | Description                              |
| ------------- | ------ | ------------------- | ---------------------------------------- |
| `DB_HOST`     | string | `postgres.internal` | PostgreSQL server hostname or IP address |
| `DB_PORT`     | number | `5432`              | PostgreSQL server port (default: `5432`) |
| `DB_USERNAME` | string | `task_manager_user` | PostgreSQL database user                 |
| `DB_PASSWORD` | string | _secret_            | PostgreSQL user password                 |
| `DB_DATABASE` | string | `task_manager_prod` | PostgreSQL database name                 |

### Optional & Operational Variables

| Variable         | Type   | Default      | Description                                                                                                                                     |
| ---------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_SSL`         | string | `false`      | Set to `true` to enable TLS/SSL connection with `rejectUnauthorized: false` (required by cloud databases like Neon, Supabase, AWS RDS, Railway) |
| `NODE_ENV`       | string | `production` | Environment mode (`production`, `staging`, `development`). Must be `development` for sync opt-in.                                               |
| `DB_SYNCHRONIZE` | string | `false`      | Explicit opt-in for schema synchronization. **Strictly ignored** unless `NODE_ENV=development`. In production, this is always `false`.          |
| `DB_LOGGING`     | string | `false`      | Enable verbose TypeORM query logging (`true` or `false`)                                                                                        |

---

## 3. Provisioning a Separate Empty Production Database

When provisioning a new PostgreSQL instance or database for production:

1. Create a dedicated database and user with appropriate privileges:
   ```sql
   CREATE DATABASE task_manager_prod;
   CREATE USER task_manager_user WITH ENCRYPTED PASSWORD 'your_secure_password_here';
   GRANT ALL PRIVILEGES ON DATABASE task_manager_prod TO task_manager_user;
   ```
2. On PostgreSQL 15+, grant schema permissions on `public`:
   ```sql
   \connect task_manager_prod
   GRANT ALL ON SCHEMA public TO task_manager_user;
   ```
3. Ensure the database is clean and contains no existing domain tables (`users`, `tasks`, etc.).

---

## 4. Production Deployment Order of Operations

To prevent race conditions, schema mismatches, or application crashes:

```
[1. Provision Empty DB] ──> [2. Set Environment Variables] ──> [3. Run Migrations] ──> [4. Verify Migrations] ──> [5. Start Bot Application]
```

1. **Step 1: Provision** the new, empty PostgreSQL database.
2. **Step 2: Configure Environment Variables** on the deployment server or container runtime (do not check in secrets).
3. **Step 3: Run the Migration Command** during the release or pre-start phase (see below).
4. **Step 4: Verify** that migrations executed cleanly using `migration:show`.
5. **Step 5: Start the Application** (`npm run start:bot` or `node dist/apps/bot/main.js`).

---

## 5. Migration Execution Commands

All migration commands use the project's centralized DataSource defined in [`libs/database/src/data-source.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/data-source.ts).

### 5.1 Check Migration Status (Pre-run check)

Inspect pending vs. executed migrations:

```bash
npm run migration:show
```

On a fresh database before migration, this outputs:

```text
[ ] InitialDatabaseSchema1771360000000
```

### 5.2 Execute Pending Migrations (Deployment Command)

Apply all pending migrations to the database:

```bash
npm run migration:run
```

Upon execution on a fresh database:

- Creates all 7 PostgreSQL enum types (`users_status_enum`, `user_identities_provider_enum`, `user_settings_onboardingstep_enum`, `tasks_type_enum`, `tasks_priority_enum`, `task_occurrences_status_enum`, `activity_events_eventtype_enum`).
- Creates all 8 domain tables in correct foreign-key dependency order (`users`, `user_identities`, `user_settings`, `tasks`, `task_occurrences`, `activity_events`, `point_transactions`, `gamification_profiles`).
- Provisions primary keys, foreign keys, unique indexes, partial indexes, and check constraints.
- Records the migration in the `migrations` table.

### 5.3 Verify Successful Completion

Run `migration:show` again:

```bash
npm run migration:show
```

Expected output:

```text
[X] InitialDatabaseSchema1771360000000
```

Running `npm run migration:run` a second time will output:

```text
No migrations are pending
```

TypeORM safely detects that `InitialDatabaseSchema1771360000000` is already applied and does not re-execute it.

### 5.4 Revert Migration (Rollback)

If needed during maintenance:

```bash
npm run migration:revert
```

> [!CAUTION]
> Reverting `InitialDatabaseSchema1771360000000` drops all 8 tables and enum types, destroying any data in those tables. Use with extreme caution in staging or production.

---

## 6. Development Schema Synchronization Safeguards

Schema synchronization (`synchronize: true`) is strictly locked down:

- In production, `synchronize` is guaranteed `false`.
- Missing or unrecognized environment variables default `synchronize` to `false`.
- To enable `synchronize: true` in local development, both variables must be set explicitly in `.env`:
  ```env
  NODE_ENV=development
  DB_SYNCHRONIZE=true
  ```

---

## 7. Generating Future Migrations

When domain models in `libs/database/src/entities/` change:

1. Update the entity class definitions.
2. In development (with a synchronized local database or disposable container), generate a diff migration:
   ```bash
   npm run migration:generate -- libs/database/src/migrations/DescriptiveMigrationName
   ```
3. Inspect the generated migration file for correctness and safety.
4. Add the new migration class to `migrations` array in:
   - [`libs/database/src/data-source.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/data-source.ts)
   - [`libs/database/src/database.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts)
   - [`libs/database/src/index.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/index.ts)
5. Run unit tests (`npm test`) and commit the migration.

---

## 8. Adopting Migration Tracking on Existing Databases

If you have an existing development database whose schema was already created via `synchronize: true` and you want TypeORM to track migrations on it without re-running `CREATE TABLE` statements:

1. Use TypeORM's `--fake` flag to record the initial migration as executed without executing its SQL:
   ```bash
   npm run typeorm -- migration:run -d libs/database/src/data-source.ts --fake
   ```
2. Verify with `npm run migration:show`. The initial schema will be marked as `[X]` (executed).
3. Any subsequent migrations generated in the future can then be executed normally via `npm run migration:run`.

---

## 9. Troubleshooting Migration Execution Failures

| Issue / Error                             | Cause                                                  | Remediation                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `connect ECONNREFUSED`                    | Database host or port unreachable                      | Verify `DB_HOST` and `DB_PORT`, check network firewalls and database service status.                                    |
| `password authentication failed`          | Invalid credentials                                    | Verify `DB_USERNAME` and `DB_PASSWORD`. Ensure no special characters in password require URL-encoding.                  |
| `SSL/TLS error` or `no pg_hba.conf entry` | Database requires SSL                                  | Set `DB_SSL=true` in environment.                                                                                       |
| `relation "..." already exists`           | Database was not empty                                 | Ensure the target database is new and empty. If adopting an existing database, use the `--fake` procedure in Section 8. |
| `permission denied for schema public`     | Insufficient PostgreSQL user permissions               | Grant schema permissions: `GRANT ALL ON SCHEMA public TO <username>;`.                                                  |
| `Unknown argument: d`                     | Calling TypeORM CLI directly with wrong argument order | Use the npm scripts (`npm run migration:run`) which specify `-d` after the subcommand.                                  |
