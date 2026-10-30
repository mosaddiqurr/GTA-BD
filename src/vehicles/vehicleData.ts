import type { Pose } from "../characters/character";

export type VehicleId = "bicycle" | "rickshaw" | "easybike" | "cng" | "motorbike" | "car_sedan" | "microbus" | "bus_city" | "truck";

export interface VehicleSpec {
  id: VehicleId;
  /** Top speed in metres per second when driven by the player. */
  topSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  /** Largest front wheel angle in radians at walking pace. */
  maxSteer: number;
  /** Sideways grip in m/s²; turns tighten or widen to stay within it. */
  grip: number;
  /** How far the body leans in a corner. Bikes lean in; everything else rolls out. */
  lean: number;
  camDistance: number;
  camHeight: number;
  radius: number; // collision circle radius
  /** Centre offsets of the collision circles along the body. */
  circles: number[];
  aiSpeed: number;
  seatPose: Pose;
  /** Passengers can ride along. */
  carries: boolean;
  /** Which side you board on: the door side, or the nearer side when null. */
  boardSide: "left" | "right" | null;
  /** How the driver's door opens, in radians of swing; 0 means no moving door. */
  doorSwing: number;
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  sound: "pedal" | "electric" | "twostroke" | "bike" | "car" | "diesel";
  horn: "bell" | "squeak" | "horn" | "airhorn";
  green: boolean; // commercial plate
}

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  bicycle: { id: "bicycle", topSpeed: 8.5, reverseSpeed: 1.5, accel: 3.0, brake: 6, maxSteer: 0.7, grip: 6.5, lean: 0.36, camDistance: 4.2, camHeight: 1.9, radius: 0.34, circles: [-0.5, 0.5], aiSpeed: 4.8, seatPose: "ride_bicycle", carries: false, boardSide: null, doorSwing: 0, length: 1.86, width: 0.61, height: 1.06, wheelRadius: 0.34, sound: "pedal", horn: "bell", green: false },
  rickshaw: { id: "rickshaw", topSpeed: 7, reverseSpeed: 1.2, accel: 1.9, brake: 4.5, maxSteer: 0.62, grip: 3.2, lean: 0.03, camDistance: 5.2, camHeight: 2.5, radius: 0.55, circles: [-0.65, 0.55], aiSpeed: 3.8, seatPose: "pedal_rickshaw", carries: true, boardSide: null, doorSwing: 0, length: 2.44, width: 1.11, height: 1.9, wheelRadius: 0.335, sound: "pedal", horn: "bell", green: false },
  easybike: { id: "easybike", topSpeed: 10.5, reverseSpeed: 2.5, accel: 2.6, brake: 5, maxSteer: 0.6, grip: 3.6, lean: 0.03, camDistance: 5.4, camHeight: 2.5, radius: 0.6, circles: [-0.8, 0.6], aiSpeed: 5.5, seatPose: "sit_drive", carries: true, boardSide: null, doorSwing: 0, length: 2.81, width: 1.1, height: 1.74, wheelRadius: 0.245, sound: "electric", horn: "squeak", green: true },
  cng: { id: "cng", topSpeed: 15, reverseSpeed: 3, accel: 3.3, brake: 6, maxSteer: 0.6, grip: 4.6, lean: 0.03, camDistance: 5.2, camHeight: 2.4, radius: 0.65, circles: [-0.8, 0.6], aiSpeed: 7, seatPose: "sit_drive", carries: true, boardSide: null, doorSwing: 0, length: 2.61, width: 1.3, height: 1.73, wheelRadius: 0.205, sound: "twostroke", horn: "squeak", green: true },
  motorbike: { id: "motorbike", topSpeed: 24, reverseSpeed: 1.5, accel: 6.2, brake: 9.5, maxSteer: 0.6, grip: 8, lean: 0.62, camDistance: 4.6, camHeight: 2, radius: 0.36, circles: [-0.55, 0.55], aiSpeed: 8.5, seatPose: "ride_motorbike", carries: false, boardSide: null, doorSwing: 0, length: 1.99, width: 0.8, height: 1.34, wheelRadius: 0.305, sound: "bike", horn: "horn", green: false },
  car_sedan: { id: "car_sedan", topSpeed: 27, reverseSpeed: 6, accel: 5.4, brake: 10.5, maxSteer: 0.6, grip: 8, lean: 0.04, camDistance: 6.4, camHeight: 2.5, radius: 0.86, circles: [-1.45, -0.05, 1.35], aiSpeed: 8.5, seatPose: "sit_drive", carries: true, boardSide: "right", doorSwing: 1.05, length: 4.48, width: 1.71, height: 1.45, wheelRadius: 0.3, sound: "car", horn: "horn", green: false },
  microbus: { id: "microbus", topSpeed: 22, reverseSpeed: 5, accel: 3.6, brake: 8, maxSteer: 0.6, grip: 6, lean: 0.06, camDistance: 7.4, camHeight: 3, radius: 0.86, circles: [-1.5, 0, 1.5], aiSpeed: 8, seatPose: "sit_drive", carries: true, boardSide: "right", doorSwing: 1.05, length: 4.83, width: 1.72, height: 2.13, wheelRadius: 0.3, sound: "car", horn: "horn", green: true },
  bus_city: { id: "bus_city", topSpeed: 18, reverseSpeed: 3.5, accel: 2.1, brake: 6, maxSteer: 0.58, grip: 4.2, lean: 0.07, camDistance: 12, camHeight: 5, radius: 1.2, circles: [-3.5, -1.2, 1.2, 3.5], aiSpeed: 7.5, seatPose: "sit_bus", carries: true, boardSide: "left", doorSwing: 0, length: 9.71, width: 2.42, height: 3.16, wheelRadius: 0.47, sound: "diesel", horn: "airhorn", green: true },
  truck: { id: "truck", topSpeed: 17, reverseSpeed: 3.5, accel: 1.9, brake: 5.5, maxSteer: 0.58, grip: 4, lean: 0.06, camDistance: 11, camHeight: 5, radius: 1.15, circles: [-2.6, -0.8, 1, 2.7], aiSpeed: 7, seatPose: "sit_bus", carries: false, boardSide: "right", doorSwing: 1.05, length: 7.75, width: 2.36, height: 3.38, wheelRadius: 0.5, sound: "diesel", horn: "airhorn", green: true },
};

/** Traffic mix: Dhaka's streets belong to buses, CNGs and rickshaws. By road class. */
export const TRAFFIC_MIX: Record<string, [VehicleId, number][]> = {
  main: [["bus_city", 0.3], ["cng", 0.24], ["car_sedan", 0.16], ["motorbike", 0.12], ["microbus", 0.08], ["truck", 0.05], ["easybike", 0.03], ["rickshaw", 0.02]],
  secondary: [["cng", 0.22], ["rickshaw", 0.2], ["bus_city", 0.15], ["car_sedan", 0.14], ["motorbike", 0.12], ["easybike", 0.08], ["microbus", 0.05], ["bicycle", 0.03], ["truck", 0.01]],
  street: [["rickshaw", 0.42], ["easybike", 0.15], ["cng", 0.12], ["motorbike", 0.12], ["bicycle", 0.1], ["car_sedan", 0.09]],
};
