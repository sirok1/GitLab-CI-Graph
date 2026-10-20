export interface JobNeed {
  job: string;
  artifacts?: boolean;
  optional: boolean;
  project?: string;
  pipeline?: string;
}
export interface PipelineJob {
  id: string;
  name: string;
  stage: string;
  needs: JobNeed[];
  dependencies: string[];
  whenType?: string;
  allowFailure?: boolean;
  environment?: string;
  hasArtifacts: boolean;
  trigger?: { description: string };
  sourceFile?: string;
  sourceLine?: number;
  extends: string[];
  rulesCount: number;
  image?: string;
  hasExplicitNeeds: boolean;
  inheritanceChain?: string[];
  unresolvedExtends?: string[];
  stageInheritedFrom?: string;
}
export interface PipelineEdge {
  source: string;
  target: string;
  artifacts?: boolean;
  optional: boolean;
}
export interface PipelineModel {
  source: { mode: string; file?: string; ref?: string };
  stages: { name: string }[];
  jobs: PipelineJob[];
  edges: PipelineEdge[];
  warnings: { message: string }[];
  errors: string[];
  valid: boolean;
  validation: string;
  files: string[];
}
export interface ViewState {
  pipeline?: PipelineModel;
  configs: string[];
  selectedFile: string;
  dark: boolean;
  loading: boolean;
  error?: string;
  gitLabConfigured?: boolean;
  defaultRef?: string;
}
export interface BridgeMessage {
  type: string;
  job?: string;
  file?: string;
  mode?: string;
  ref?: string;
  image?: string;
}
declare global {
  interface Window {
    ideSend?: (message: BridgeMessage) => void;
  }
}
export const send = (message: BridgeMessage) => window.ideSend?.(message);
