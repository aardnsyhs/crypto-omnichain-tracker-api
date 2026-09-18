-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_histories" (
    "id" UUID NOT NULL,
    "user_session_id" UUID NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "cache_hit" BOOLEAN NOT NULL,
    "searched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'blockchair',
    "endpoint" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "cache_outcome" TEXT NOT NULL,
    "upstream_status_code" INTEGER,
    "total_duration_ms" INTEGER NOT NULL,
    "provider_duration_ms" INTEGER,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_id_key" ON "user_sessions"("session_id");

-- CreateIndex
CREATE INDEX "search_histories_user_session_id_searched_at_idx" ON "search_histories"("user_session_id", "searched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_request_logs_request_id_key" ON "api_request_logs"("request_id");

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_session_id_fkey" FOREIGN KEY ("user_session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
