import { Component, input } from "@angular/core";
import { NgDiagramNodeTemplate, NgDiagramPortComponent, SimpleNode } from "ng-diagram";
import { NodeData } from "../types";

@Component({
  selector: "diagram-node",
  templateUrl: "./node-template.component.html",
  styleUrls: ["./node-template.component.scss"],
  imports: [NgDiagramPortComponent]
})
export class DiagramNodeComponent implements NgDiagramNodeTemplate<NodeData, SimpleNode<NodeData>> {
  node = input.required<SimpleNode<NodeData>>();
}