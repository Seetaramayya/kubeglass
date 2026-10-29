// Resource kinds kubeglass knows about. Shared by the server (validation) and the UI (sidebar, kubectl hints).
export const KINDS = {
  nodes: { apiVersion: 'v1', kind: 'Node', namespaced: false, label: 'Nodes', group: 'Cluster', kubectl: 'node' },
  namespaces: { apiVersion: 'v1', kind: 'Namespace', namespaced: false, label: 'Namespaces', group: 'Cluster', kubectl: 'namespace' },
  events: { apiVersion: 'v1', kind: 'Event', namespaced: true, label: 'Events', group: 'Cluster', kubectl: 'event' },

  pods: { apiVersion: 'v1', kind: 'Pod', namespaced: true, label: 'Pods', group: 'Workloads', kubectl: 'pod' },
  deployments: { apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true, label: 'Deployments', group: 'Workloads', kubectl: 'deployment' },
  statefulsets: { apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true, label: 'StatefulSets', group: 'Workloads', kubectl: 'statefulset' },
  daemonsets: { apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true, label: 'DaemonSets', group: 'Workloads', kubectl: 'daemonset' },
  replicasets: { apiVersion: 'apps/v1', kind: 'ReplicaSet', namespaced: true, label: 'ReplicaSets', group: 'Workloads', kubectl: 'replicaset' },
  jobs: { apiVersion: 'batch/v1', kind: 'Job', namespaced: true, label: 'Jobs', group: 'Workloads', kubectl: 'job' },
  cronjobs: { apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true, label: 'CronJobs', group: 'Workloads', kubectl: 'cronjob' },

  configmaps: { apiVersion: 'v1', kind: 'ConfigMap', namespaced: true, label: 'ConfigMaps', group: 'Config', kubectl: 'configmap' },
  secrets: { apiVersion: 'v1', kind: 'Secret', namespaced: true, label: 'Secrets', group: 'Config', kubectl: 'secret' },
  hpas: { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', namespaced: true, label: 'HPA', group: 'Config', kubectl: 'hpa' },

  services: { apiVersion: 'v1', kind: 'Service', namespaced: true, label: 'Services', group: 'Network', kubectl: 'service' },
  ingresses: { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true, label: 'Ingresses', group: 'Network', kubectl: 'ingress' },

  pvcs: { apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespaced: true, label: 'Persistent Volume Claims', group: 'Storage', kubectl: 'pvc' },
  pvs: { apiVersion: 'v1', kind: 'PersistentVolume', namespaced: false, label: 'Persistent Volumes', group: 'Storage', kubectl: 'pv' },
  storageclasses: { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', namespaced: false, label: 'Storage Classes', group: 'Storage', kubectl: 'storageclass' },
};

export const KIND_BY_NAME = Object.fromEntries(Object.entries(KINDS).map(([key, k]) => [k.kind, key]));

export const SCALABLE = new Set(['deployments', 'statefulsets']);
export const RESTARTABLE = new Set(['deployments', 'statefulsets', 'daemonsets']);
