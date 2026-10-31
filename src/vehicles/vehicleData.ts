import type { Pose } from "../characters/character";

export type VehicleId = "bicycle" | "rickshaw" | "easybike" | "cng" | "motorbike" | "car_sedan" | "microbus" | "bus_city" | "truck" | "leguna" | "goods_van" | "garbage_truck" | "ambulance" | "police_car" | "wrecker";

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
  /** The driver's controls, in the model's own coordinates. Wheel: centre, radius, tilt back in degrees.
   *  Feet: how far the floor is below the seat and how far forward the pedals are. */
  controls: { wheel?: readonly [number, number, number, number, number]; floorDrop: number; footForward: number; lean?: number; seatShift?: readonly [number, number, number] };
  /** Which side you board on: the door side, or the nearer side when null. */
  boardSide: "left" | "right" | null;
  /** How the doors open, in radians of swing; 0 means no moving door. */
  doorSwing: number;
  /** Height of the door handles above the ground. */
  handleY: number;
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  sound: "pedal" | "electric" | "twostroke" | "bike" | "car" | "diesel";
  horn: "bell" | "squeak" | "horn" | "airhorn";
  green: boolean; // commercial plate
}

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  bicycle: { id: "bicycle", topSpeed: 8.5, reverseSpeed: 1.5, accel: 3.0, brake: 6, maxSteer: 0.7, grip: 6.5, lean: 0.36, camDistance: 4.2, camHeight: 1.9, radius: 0.34, circles: [-0.5, 0.5], aiSpeed: 4.8, seatPose: "ride_bicycle", controls: { floorDrop: 0, footForward: 0, lean: 0.18 }, carries: false, boardSide: null, doorSwing: 0, handleY: 0.9, length: 1.86, width: 0.61, height: 1.06, wheelRadius: 0.34, sound: "pedal", horn: "bell", green: false },
  rickshaw: { id: "rickshaw", topSpeed: 7, reverseSpeed: 1.2, accel: 1.9, brake: 4.5, maxSteer: 0.62, grip: 3.2, lean: 0.03, camDistance: 5.2, camHeight: 2.5, radius: 0.55, circles: [-0.65, 0.55], aiSpeed: 3.8, seatPose: "pedal_rickshaw", controls: { floorDrop: 0, footForward: 0, lean: 0.18 }, carries: true, boardSide: null, doorSwing: 0, handleY: 0.9, length: 2.44, width: 1.11, height: 1.9, wheelRadius: 0.335, sound: "pedal", horn: "bell", green: false },
  easybike: { id: "easybike", topSpeed: 10.5, reverseSpeed: 2.5, accel: 2.6, brake: 5, maxSteer: 0.6, grip: 3.6, lean: 0.03, camDistance: 5.4, camHeight: 2.5, radius: 0.6, circles: [-0.8, 0.6], aiSpeed: 5.5, seatPose: "drive_easybike", controls: { floorDrop: 0.42, footForward: 0.36, lean: 0.1, seatShift: [0, 0.07, -0.1] }, carries: true, boardSide: null, doorSwing: 0, handleY: 0.9, length: 2.81, width: 1.1, height: 1.74, wheelRadius: 0.245, sound: "electric", horn: "squeak", green: true },
  cng: { id: "cng", topSpeed: 15, reverseSpeed: 3, accel: 3.3, brake: 6, maxSteer: 0.6, grip: 4.6, lean: 0.03, camDistance: 5.2, camHeight: 2.4, radius: 0.65, circles: [-0.8, 0.6], aiSpeed: 7, seatPose: "drive_cng", controls: { floorDrop: 0.42, footForward: 0.36, lean: 0.1, seatShift: [0, 0.07, -0.1] }, carries: true, boardSide: null, doorSwing: 1.3, handleY: 0.98, length: 2.61, width: 1.3, height: 1.73, wheelRadius: 0.205, sound: "twostroke", horn: "squeak", green: true },
  motorbike: { id: "motorbike", topSpeed: 24, reverseSpeed: 1.5, accel: 6.2, brake: 9.5, maxSteer: 0.6, grip: 8, lean: 0.62, camDistance: 4.6, camHeight: 2, radius: 0.36, circles: [-0.55, 0.55], aiSpeed: 8.5, seatPose: "ride_motorbike", controls: { floorDrop: 0, footForward: 0, lean: 0.25 }, carries: false, boardSide: null, doorSwing: 0, handleY: 0.9, length: 1.99, width: 0.8, height: 1.34, wheelRadius: 0.305, sound: "bike", horn: "horn", green: false },
  car_sedan: { id: "car_sedan", topSpeed: 27, reverseSpeed: 6, accel: 5.4, brake: 10.5, maxSteer: 0.6, grip: 8, lean: 0.04, camDistance: 6.4, camHeight: 2.5, radius: 0.86, circles: [-1.45, -0.05, 1.35], aiSpeed: 8.5, seatPose: "drive_car", controls: { wheel: [0.33, 0.86, 0.27, 0.17, 24], floorDrop: 0.17, footForward: 0.62, lean: -0.05 }, carries: true, boardSide: "right", doorSwing: 1.05, handleY: 0.86, length: 4.48, width: 1.71, height: 1.45, wheelRadius: 0.3, sound: "car", horn: "horn", green: false },
  microbus: { id: "microbus", topSpeed: 22, reverseSpeed: 5, accel: 3.6, brake: 8, maxSteer: 0.6, grip: 6, lean: 0.06, camDistance: 7.4, camHeight: 3, radius: 0.86, circles: [-1.5, 0, 1.5], aiSpeed: 8, seatPose: "drive_micro", controls: { wheel: [0.40, 1.08, 1.12, 0.185, 28], floorDrop: 0.32, footForward: 0.48, lean: 0.02 }, carries: true, boardSide: "right", doorSwing: 1.05, handleY: 1.08, length: 4.83, width: 1.72, height: 2.13, wheelRadius: 0.3, sound: "car", horn: "horn", green: true },
  bus_city: { id: "bus_city", topSpeed: 18, reverseSpeed: 3.5, accel: 2.1, brake: 6, maxSteer: 0.58, grip: 4.2, lean: 0.07, camDistance: 12, camHeight: 5, radius: 1.2, circles: [-3.5, -1.2, 1.2, 3.5], aiSpeed: 7.5, seatPose: "drive_bus", controls: { wheel: [0.68, 1.56, 4.14, 0.235, 45], floorDrop: 0.5, footForward: 0.5, lean: 0.06 }, carries: true, boardSide: "left", doorSwing: 1.45, handleY: 1.02, length: 9.71, width: 2.42, height: 3.16, wheelRadius: 0.47, sound: "diesel", horn: "airhorn", green: true },
  truck: { id: "truck", topSpeed: 17, reverseSpeed: 3.5, accel: 1.9, brake: 5.5, maxSteer: 0.58, grip: 4, lean: 0.06, camDistance: 11, camHeight: 5, radius: 1.15, circles: [-2.6, -0.8, 1, 2.7], aiSpeed: 7, seatPose: "drive_truck", controls: { wheel: [0.55, 1.72, 3.0, 0.22, 42], floorDrop: 0.5, footForward: 0.55, lean: 0.04 }, carries: false, boardSide: "right", doorSwing: 1.05, handleY: 1.12, length: 7.75, width: 2.36, height: 3.38, wheelRadius: 0.5, sound: "diesel", horn: "airhorn", green: true },
  leguna: { id: "leguna", topSpeed: 16, reverseSpeed: 5, accel: 3.6, brake: 8, maxSteer: 0.6, grip: 6, lean: 0.06, camDistance: 7.4, camHeight: 3, radius: 0.86, circles: [-1.5, 0, 1.5], aiSpeed: 6.6, seatPose: "drive_micro", controls: { wheel: [0.40, 1.08, 1.12, 0.185, 28], floorDrop: 0.32, footForward: 0.48, lean: 0.02 }, carries: true, boardSide: "right", doorSwing: 1.05, handleY: 1.08, length: 4.83, width: 1.72, height: 2.13, wheelRadius: 0.3, sound: "car", horn: "horn", green: true },
  ambulance: { id: "ambulance", topSpeed: 25, reverseSpeed: 5, accel: 4.4, brake: 8, maxSteer: 0.6, grip: 6, lean: 0.06, camDistance: 7.4, camHeight: 3, radius: 0.86, circles: [-1.5, 0, 1.5], aiSpeed: 13, seatPose: "drive_micro", controls: { wheel: [0.40, 1.08, 1.12, 0.185, 28], floorDrop: 0.32, footForward: 0.48, lean: 0.02 }, carries: true, boardSide: "right", doorSwing: 1.05, handleY: 1.08, length: 4.83, width: 1.72, height: 2.13, wheelRadius: 0.3, sound: "car", horn: "horn", green: true },
  police_car: { id: "police_car", topSpeed: 27, reverseSpeed: 6, accel: 5.4, brake: 10.5, maxSteer: 0.6, grip: 8, lean: 0.04, camDistance: 6.4, camHeight: 2.5, radius: 0.86, circles: [-1.45, -0.05, 1.35], aiSpeed: 9, seatPose: "drive_car", controls: { wheel: [0.33, 0.86, 0.27, 0.17, 24], floorDrop: 0.17, footForward: 0.62, lean: -0.05 }, carries: true, boardSide: "right", doorSwing: 1.05, handleY: 0.86, length: 4.48, width: 1.71, height: 1.45, wheelRadius: 0.3, sound: "car", horn: "horn", green: false },
  goods_van: { id: "goods_van", topSpeed: 18, reverseSpeed: 3.5, accel: 1.9, brake: 5.5, maxSteer: 0.58, grip: 4, lean: 0.06, camDistance: 11, camHeight: 5, radius: 1.15, circles: [-2.6, -0.8, 1, 2.7], aiSpeed: 7.6, seatPose: "drive_truck", controls: { wheel: [0.55, 1.72, 3.0, 0.22, 42], floorDrop: 0.5, footForward: 0.55, lean: 0.04 }, carries: false, boardSide: "right", doorSwing: 1.05, handleY: 1.12, length: 7.75, width: 2.36, height: 3.38, wheelRadius: 0.5, sound: "diesel", horn: "airhorn", green: true },
  garbage_truck: { id: "garbage_truck", topSpeed: 14, reverseSpeed: 3.5, accel: 1.9, brake: 5.5, maxSteer: 0.58, grip: 4, lean: 0.06, camDistance: 11, camHeight: 5, radius: 1.15, circles: [-2.6, -0.8, 1, 2.7], aiSpeed: 4.6, seatPose: "drive_truck", controls: { wheel: [0.55, 1.72, 3.0, 0.22, 42], floorDrop: 0.5, footForward: 0.55, lean: 0.04 }, carries: false, boardSide: "right", doorSwing: 1.05, handleY: 1.12, length: 7.75, width: 2.36, height: 3.3, wheelRadius: 0.5, sound: "diesel", horn: "airhorn", green: true },
  wrecker: { id: "wrecker", topSpeed: 18, reverseSpeed: 3.5, accel: 1.9, brake: 5.5, maxSteer: 0.58, grip: 4, lean: 0.06, camDistance: 11, camHeight: 5, radius: 1.15, circles: [-2.6, -0.8, 1, 2.7], aiSpeed: 8.6, seatPose: "drive_truck", controls: { wheel: [0.55, 1.72, 3.0, 0.22, 42], floorDrop: 0.5, footForward: 0.55, lean: 0.04 }, carries: false, boardSide: "right", doorSwing: 1.05, handleY: 1.12, length: 7.75, width: 2.36, height: 3.38, wheelRadius: 0.5, sound: "diesel", horn: "airhorn", green: true },
};

/** Traffic mix: Dhaka's streets belong to buses, CNGs and rickshaws. By road class. */
/** How heavy each one is with someone aboard, in kilograms. */
export const VEHICLE_MASS: Record<VehicleId, number> = { bicycle: 90, motorbike: 230, rickshaw: 240, easybike: 430, cng: 520, car_sedan: 1250, microbus: 1750, truck: 6500, bus_city: 8000, leguna: 1500, goods_van: 5500, garbage_truck: 7000, ambulance: 1800, police_car: 1350, wrecker: 6000 };

/** How the kind of road changes the speed people drive at. */
/** Things that aren't the bulk of traffic but that any Dhaka street will have a few of, by share. */
export const ALSO_ON_THE_ROAD: Record<string, [VehicleId, number][]> = {
  main: [["goods_van", 0.05], ["ambulance", 0.008], ["garbage_truck", 0.012], ["leguna", 0.03]],
  secondary: [["leguna", 0.1], ["goods_van", 0.03], ["garbage_truck", 0.02], ["ambulance", 0.006]],
  street: [["garbage_truck", 0.012], ["leguna", 0.03]],
};

export const ROAD_PACE: Record<string, number> = { main: 1.5, secondary: 1.18, street: 0.88 };

export const TRAFFIC_MIX: Record<string, [VehicleId, number][]> = {
  main: [["car_sedan", 0.2], ["cng", 0.2], ["motorbike", 0.2], ["bus_city", 0.15], ["microbus", 0.07], ["rickshaw", 0.05], ["easybike", 0.05], ["bicycle", 0.05], ["truck", 0.03]],
  secondary: [["rickshaw", 0.21], ["motorbike", 0.18], ["cng", 0.17], ["car_sedan", 0.15], ["bus_city", 0.07], ["easybike", 0.08], ["bicycle", 0.08], ["microbus", 0.05], ["truck", 0.01]],
  street: [["rickshaw", 0.36], ["motorbike", 0.17], ["bicycle", 0.14], ["easybike", 0.13], ["cng", 0.1], ["car_sedan", 0.1]],
};
