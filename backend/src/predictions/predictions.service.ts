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
  /** What the number rests on — never 'ok' since PRED-10 (7.9.26). */
  reliability: 'within_project_history' | 'low_transfer_prior';
  basis?: string;                      // e.g. 'cross_project_model'
  prediction: Prediction | null;       // null under abstain policy on young projects
  note: string | null;
}

/** One signed SHAP contribution, already in domain language (PRED-3). */
export interface Contribution {
  feature: string;
  label_en: string;
  label_he: string;
  value: number | string | null;
  contribution: number;                // calibrated-probability units (KAN-130)
}

export interface Explanation {
  prediction: Prediction;
  top_contributions: Contribution[];
  base_probability: number | null;
  contribution_space: string;
  note: string;
}

/** One row of POST /explain/project (KAN-40): null explanation exactly when predict abstains. */
export interface ProjectExplanation {
  task_id: string;
  reliability: 'within_project_history' | 'low_transfer_prior';
  basis?: string;
  explanation: Explanation | null;
  risk_level: string | null;
  abstain_reason: string | null;
  note: string | null;
}

/** Thin client for the Python AI service (FastAPI). */
@Injectable()
export class PredictionsService {
  private readonly log = new Logger(PredictionsService.name);
  private readonly baseUrl: string;
  /** NFR-SEC-5: shared secret; the AI service answers 401 without it. */
  private readonly token: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = cfg.get('AI_SERVICE_URL', 'http://localhost:8001');
    this.token = cfg.get('AI_SERVICE_TOKEN', '');
  }

  /**
   * Predict for a whole project from raw entities (the PRED-9 path).
   * Callers must persist per task: late_probability, risk_level, reliability,
   * basis, model_version and predictedAt — required by TASK-5 traceability.
   * predictedAt moves only when a prediction is present (KAN-127).
   */
  async predictProject(payload: ProjectGraphPayload): Promise<ProjectPrediction[] | null> {
    try {
      const { data } = await axios.post<ProjectPrediction[]>(
        `${this.baseUrl}/predict/project`, payload,
        { timeout: 20000, headers: { 'X-Internal-Token': this.token } });
      return data;
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        // contract violation (bad field / out-of-range value) — a bug, not an outage
        this.log.error(`AI service rejected payload (422): ${JSON.stringify(e.response.data)}`);
      } else if (axios.isAxiosError(e) && e.response?.status === 401) {
        // NFR-SEC-5: configuration error, not an outage - the tokens do not match
        this.log.error('AI service refused the service token (401): check AI_SERVICE_TOKEN in .env');
      } else {
        this.log.warn(`AI service unavailable: ${(e as Error).message}`);
      }
      return null; // NFR-REL-1: the platform stays usable without predictions
    }
  }

  /**
   * PRED-3 through the platform (KAN-40): explanations for `taskIds`, computed
   * from the same raw graph as predictProject - the whole project, because an
   * activity's features depend on the others. Null when the service is
   * unavailable, like predictProject.
   */
  async explainProject(
    payload: ProjectGraphPayload, taskIds: string[], topK = 5,
  ): Promise<ProjectExplanation[] | null> {
    try {
      const { data } = await axios.post<ProjectExplanation[]>(
        `${this.baseUrl}/explain/project`, { ...payload, task_ids: taskIds },
        { timeout: 20000, params: { top_k: topK }, headers: { 'X-Internal-Token': this.token } });
      return data;
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 422 || status === 401) {
        this.log.error(`AI service refused /explain/project (${status}): ${
          JSON.stringify(axios.isAxiosError(e) ? e.response?.data : null)}`);
      } else {
        this.log.warn(`AI service unavailable: ${(e as Error).message}`);
      }
      return null;
    }
  }
}
