import { ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import {
  initializeModel,
  NgDiagramComponent,
  type Edge,
  type Node,
  provideNgDiagram,
  NgDiagramNodeTemplateMap,
  ModelAdapter,
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  DiagramInitEvent,
  SelectionMovedEvent,
} from 'ng-diagram';
import { DiagramNodeComponent } from './node-template/node-template.component';
import { Data, NodeData } from './types';

type LayoutDirection = 'RIGHT' | 'DOWN';
const ELK_BASE_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.layered.nodePlacement.strategy": "SIMPLE",
  "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "spacing.edgeNode": "70",
  "spacing.nodeNode": "50",
  "layered.spacing.edgeNodeBetweenLayers": "50",
  "layered.spacing.nodeNodeBetweenLayers": "50",
  "edgeLabels.sideSelection": "ALWAYS_UP",
  "layering.strategy": "NETWORK_SIMPLEX",
  "nodePlacement.strategy": "BRANDES_KOEPF",
};

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  imports: [NgDiagramComponent],
  providers: [provideNgDiagram()],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly injector = inject(Injector);
  private readonly ngDiagramModelService = inject(NgDiagramModelService);
  private readonly ngDiagramService = inject(NgDiagramService);
  private readonly ngDiagramViewportService = inject(NgDiagramViewportService);
  private readonly elk = new ELK();

  readonly nodeTemplateMap = new NgDiagramNodeTemplateMap([
    ['node', DiagramNodeComponent]
  ]);
  readonly layoutDirection = signal<LayoutDirection>('DOWN');
  readonly buttonLabel = computed(() =>
    this.layoutDirection() === 'DOWN' ? 'Switch to horizontal' : 'Switch to vertical'
  );

  diagram: ModelAdapter;

  data: Data[] = [
    { id: 'start', label: 'Start', next: 'review' },
    { id: 'review', label: 'Review', next: 'done' },
    { id: 'done', label: 'Done' }
  ]

  readonly config = {
    nodeDraggingEnabled: true,
    hideWatermark: true,
    linking: {
      validateConnection: () => true,
      selectNodeOnPortPress: false
    },
    zoom: {
      step: .25
    }
  }

  constructor() {
    this.diagram = initializeModel({ nodes: [], edges: [] }, this.injector);
  }

  onDiagramInit(event: DiagramInitEvent) {
    void this.applyLayout(true);
  }

  onSelectionMoved(event: SelectionMovedEvent) {
    const movedNodeIds = new Set(event.nodes.map(node => node.id));
    const connectedEdges = this.diagram.getEdges()
      .filter(edge => movedNodeIds.has(edge.source) || movedNodeIds.has(edge.target));

    if (connectedEdges.length > 0) {
      this.ngDiagramModelService.updateEdges(connectedEdges.map(edge => ({
        id: edge.id,
        points: undefined,
        routing: 'orthogonal',
        routingMode: 'auto'
      })));
    }
  }

  toggleLayoutDirection(): void {
    this.layoutDirection.set(this.layoutDirection() === 'DOWN' ? 'RIGHT' : 'DOWN')
    void this.applyLayout(true);
  }

  private async applyLayout(reformat: boolean): Promise<void> {
    await this.ngDiagramService.transaction(async () => {
      await this.createUpdateDeleteNodesAndEdges();
    }, { waitForMeasurements: true });

    if (reformat) {
      window.requestAnimationFrame(async () => await this.reformatDiagram());
      return;
    }
  }

  private async createUpdateDeleteNodesAndEdges() {
    const currentNodes = this.diagram.getNodes() as Node<NodeData>[];
    const currentEdges = this.diagram.getEdges() as Edge[];

    const currentNodeById = new Map(currentNodes.map(node => [node.id, node]));
    const currentEdgeById = new Map(currentEdges.map(edge => [edge.id, edge]));

    const nextNodes = this.buildNodes(this.data || [], this.layoutDirection());
    const nextEdges = this.buildEdges(this.data || []);

    const nextNodeIds = new Set(nextNodes.map(node => node.id));
    const deletedNodeIds = currentNodes.filter(node => !nextNodeIds.has(node.id)).map(node => node.id);
    if (deletedNodeIds.length > 0) {
      this.ngDiagramModelService.deleteNodes(deletedNodeIds);
    }

    const updatedNodes: Node<NodeData>[] = [];
    const addedNodes: Node<NodeData>[] = [];
    let appendedCount = 0;

    for (const node of nextNodes) {
      const existing = currentNodeById.get(node.id);

      if (existing) {
        updatedNodes.push({ ...node, position: { ...existing.position } })
      } else {
        node.position = { x: 0, y: 0 };
        appendedCount += 1;
        addedNodes.push(node);
      }
    }

    if (updatedNodes.length > 0) {
      this.ngDiagramModelService.updateNodes(updatedNodes);
    }

    if (addedNodes.length > 0) {
      this.ngDiagramModelService.addNodes(addedNodes);
    }

    const nextEdgeIds = new Set(nextEdges.map(edge => edge.id));
    const deletedEdgeIds = currentEdges.filter(edge => !nextEdgeIds.has(edge.id)).map(edge => edge.id);
    if (deletedEdgeIds.length > 0) {
      this.ngDiagramModelService.deleteEdges(deletedEdgeIds);
    }

    const addedEdges: Edge[] = [];
    const updatedEdges: (Pick<Edge, 'id'> & Partial<Edge>)[] = [];

    for (const edge of nextEdges) {
      const existing = currentEdgeById.get(edge.id);
      if (!existing) {
        edge.routing = 'orthogonal';
        edge.routingMode = 'auto';
        edge.points = undefined;
        addedEdges.push(edge);
        continue;
      }

      updatedEdges.push(edge);
    }

    if (addedEdges.length > 0) {
      this.ngDiagramModelService.addEdges(addedEdges);
    }

    if (updatedEdges.length > 0) {
      this.ngDiagramModelService.updateEdges(updatedEdges);
    }
  }

  private async reformatDiagram() {
    const nodes = this.ngDiagramModelService.getModel().getNodes() as Node<NodeData>[];
    const edges = this.ngDiagramModelService.getModel().getEdges() as Edge[];

    const { nodes: finalNodes, edges: finalEdges } = await this.getDiagramLayout(nodes, edges, this.layoutDirection());

    await this.ngDiagramService.transaction(async () => {

      this.ngDiagramModelService.updateNodes(finalNodes);
      this.ngDiagramModelService.updateEdges(finalEdges);

    }, { waitForMeasurements: true });

    this.ngDiagramViewportService.zoomToFit({ padding: [24, 32, 24, 32] });
  }

  private async getDiagramLayout(nodes: Node<NodeData>[], edges: Edge[], direction: LayoutDirection) {
    const nodesToLayout = nodes.map(
      ({ id: nodeId, size, measuredPorts }): ElkNode => ({
        id: nodeId,
        ...size,
        layoutOptions: {
          portConstraints: 'FIXED_POS',
        },
        ports: measuredPorts?.map(
          ({ id: portId, position, size: portSize }: any) => ({
            id: `${nodeId}:${portId}`,
            ...portSize,
            ...position,
          })
        ),
      })
    );

    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        ...ELK_BASE_LAYOUT_OPTIONS,
        "elk.direction": direction,
      },
      children: nodesToLayout,
      edges: edges.map(({ id, source, target, sourcePort, targetPort }) => {
        const sourceWithPort = `${source}:${sourcePort}`;
        const targetWithPort = `${target}:${targetPort}`;

        return {
          id,
          sources: [sourceWithPort],
          targets: [targetWithPort],
        };
      }),
    };

    const { children: laidOutNodes, edges: laidOutEdges } = await this.elk.layout(graph);

    const updatedNodes: Node[] = nodes.map((node) => {
      const { position: { x: baseX, y: baseY } } = node;

      const { x = baseX, y = baseY } = laidOutNodes?.find(({ id }: any) => id === node.id) ?? { x: baseX, y: baseY };

      return {
        ...node,
        position: { x, y },
      };
    });

    const updatedEdges: Edge[] = edges.map((edge) => {
      const elkEdge = laidOutEdges?.find(({ id }: any) => id === edge.id);
      if (!elkEdge) {
        return edge;
      }

      const points = this.getLayoutPoints(elkEdge);
      if (!points.length) {
        return {
          ...edge,
          routingMode: 'auto',
          points: undefined,
        };
      }

      return {
        ...edge,
        // Set routing mode to manual to disable automatic routing from ngDiagram
        // and use the exact points calculated by ELK layout engine
        routingMode: 'manual',
        points,
      };
    });

    return { nodes: updatedNodes, edges: updatedEdges };
  }

  private buildNodes(
    data: Data[],
    layoutDirection: LayoutDirection = "DOWN"
  ) {
    const nodes: Node<NodeData>[] = [];

    for (const d of data) {
      nodes.push({
        id: d.id,
        type: 'node',
        position: {
          x: 0,
          y: 0
        },
        data: {
          label: d.label,
          layoutDirection,
        },
      });
    }

    return nodes;
  }

  private buildEdges(data: Data[]) {
    const edges: Edge[] = [];

    for (const d of data) {
      if (d.next) {
        edges.push({
          id: `${d.id}-${d.next}`,
          source: d.id,
          target: d.next,
          sourcePort: "port-out",
          targetPort: "port-in",
          data: {},
          targetArrowhead: "ng-diagram-arrow",
        });
      }
    }

    return edges;
  }

  private getLayoutPoints(elkEdge: ElkExtendedEdge) {
    if (!elkEdge.sections?.length) return [];

    const section = elkEdge.sections[0];
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

    return points.filter((point): point is { x: number; y: number } => (
      !!point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
    ));
  }

}
