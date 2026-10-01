-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "geminiFallbackModel" TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
ADD COLUMN     "geminiModel" TEXT NOT NULL DEFAULT 'gemini-3.5-flash-lite';
