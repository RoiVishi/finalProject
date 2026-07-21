import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface TaskFeatures {
  planned_duration_days?: number;
  total_float_hr?: number;
  free_float_hr?: number;
  rel_position?: number;
  proj_n_tasks?: number;
  proj_span_days?: number;
  n_pred?: number;
  n_succ?: number;
  upstream_cnt?: number;
  downstream_cnt?: number;
  task_type?: string;
}

export interface Prediction {
  late_probability: number;
  is_late: boolean;
  risk_level: 'low' | 'medium' | 'high';
}

/** Thin client for the Python AI service (FastAPI). */
@Injectable()
export class PredictionsService {
  private readonly log = new Logger(PredictionsService.name);
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = cfg.get('AI_SERVICE_URL', 'http://localhost:8001');
  }

  async predict(features: TaskFeatures): Promise<Prediction | null> {
    try {
      const { data } = await axios.post<Prediction>(`${this.baseUrl}/predict`, features, { timeout: 5000 });
      return data;
    } catch (e) {
      this.log.warn(`AI service unavailable: ${e.message}`);
      return null; // system stays usable without predictions
    }
  }

  async predictBatch(features: TaskFeatures[]): Promise<Prediction[] | null> {
    try {
      const { data } = await axios.post<Prediction[]>(`${this.baseUrl}/predict/batch`, features, { timeout: 15000 });
      return data;
    } catch (e) {
      this.log.warn(`AI service unavailable: ${e.message}`);
      return null;
    }
  }
}
