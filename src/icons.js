import {
  Bell, Box, Boxes, Briefcase, Cable, CalendarClock, Copy, Database, FileCog, FolderTree, Gauge, Globe,
  HardDrive, KeyRound, Layers, Network, Package, Server, Ship, Waypoints, Workflow,
} from 'lucide-react';

export const KIND_ICONS = {
  nodes: Server,
  namespaces: FolderTree,
  events: Bell,
  pods: Box,
  deployments: Layers,
  statefulsets: Database,
  daemonsets: Workflow,
  replicasets: Copy,
  jobs: Briefcase,
  cronjobs: CalendarClock,
  configmaps: FileCog,
  secrets: KeyRound,
  hpas: Gauge,
  services: Network,
  ingresses: Globe,
  pvcs: Cable,
  pvs: HardDrive,
  storageclasses: Package,
};

export const GROUP_ICONS = { Cluster: Ship, Workloads: Boxes, Config: FileCog, Network: Waypoints, Storage: HardDrive };
