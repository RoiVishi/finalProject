import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * PRED-9 contract (v0.3.0 of the AI service): the backend NEVER computes a
 * feature. It sends RAW entities — tasks, dependencies, dates — to
 * POST /predict/project, and the adapter inside the AI service derives the
 * feature vectors. Keep these types in sync with ai-service/app/adapter.py
 * (ProjectGraphPayload); unknown fields are rejected there with 422.
 */
export interface RawTask {
  id: string;
  planned_start?: string | null;   // ISO date (YYYY-MM-DD)
  planned_finish?: string | null;
  type?: string;                   // platform vocabulary: task | milestone | ...
}

export interface RawDependency {
  predecessor_id: string;
  successor_id: string;            // finish-to-start (TASK-3)
}

export interface ProjectGraphPayload {
  project: {
    planned_start?: string | null;
    planned_finish?: string | null;
    /**
     * Reliability metadata, NOT a model feature: share (0..1) of the project's
     * tasks already completed. Drives the cold-start gate (RR-11 threshold):
     * below it the AI service marks predictions low_transfer_prior or abstains.
     */
    completed_share?: number | null;
  };
  tasks: RawTask[];
  dependencies: RawDependency[];
}

export interface Prediction {
  late_probability: number;
  is_late: boolean;
  risk_level: 'low' | 'medium' | 'high';
  estimated_delay_days: number | null; // null while the regressor is gated off (PRED-11)
  model_version: string;               // traceability (TASK-5): persist with the task
  feature_schema_version: string | null;
}

export interface ProjectPrediction {
  task_id: string;
  reliability: 'ok' | 'low_transfer_prior';
  prediction: Prediction | null;       // null under abstain policy on young projects
  note: string | null;
}

/** Thin client for the Python AI service (FastAPI). */
@Injectable()
export class PredictionsService {
  private readonly log = new Logger(PredictionsService.name);
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = cfg.get('AI_SERVICE_URL', 'http://localhost:8001');
  }

  /**
   * Predict for a whole project from raw entities (the PRED-9 path).
   * Callers must persist per task: late_probability, risk_level, reliability,
   * model_version and predictedAt (= now) — required by TASK-5 traceability.
   */
  async predictProject(payload: ProjectGraphPayload): Promise<ProjectPrediction[] | null> {
    try {
      const { data } = await axios.post<ProjectPrediction[]>(
        `${this.baseUrl}/predict/project`, payload, { timeout: 20000 });
      return data;
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        // contract violation (bad field / out-of-range value) — a bug, not an outage
        this.log.error(`AI service rejected payload (422): ${JSON.stringify(e.response.data)}`);
      } else {
        this.log.warn(`AI service unavailable: ${(e as Error).message}`);
      }
      return null; // NFR-REL-1: the platform stays usable without predictions
    }
  }
}
