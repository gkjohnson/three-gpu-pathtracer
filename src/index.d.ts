import {
	DataTexture,
	RectAreaLight,
	SpotLight,
	Camera,
	PerspectiveCamera,
	MeshStandardMaterial,
	Vector2,
	BufferGeometry,
	Color,
	MeshStandardMaterialParameters,
	Spherical,
} from 'three';
import { MeshBVH, BVHOptions } from 'three-mesh-bvh';

// three.js type augmentation

declare module 'three/src/materials/MeshStandardMaterial' {

	export interface MeshStandardMaterial {

		/**
		 * Whether to render the object as completely transparent against the rest of the environment
		 * so other objects can be composited later.
		 *
		 * Used by `WebGPUPathTracer` from `three-gpu-pathtracer/webgpu`.
		 */
		matte: boolean;
		/**
		 * Whether the object should cast a shadow.
		 *
		 * Used by `WebGPUPathTracer` from `three-gpu-pathtracer/webgpu`.
		 */
		castShadow: boolean;

	}

}

// core

export interface BVHWorker {

	generate( geometry : BufferGeometry, options?: BVHOptions ) : Promise<MeshBVH>

}

// objects

export class PhysicalCamera extends PerspectiveCamera {

	focusDistance: number;
	fStop: number;
	bokehSize: number;
	apertureBlades: number;
	apertureRotation: number;
	anamorphicRatio: number;

}

export class EquirectCamera extends Camera {

	readonly isEquirectCamera: true;

}

export class PhysicalSpotLight extends SpotLight {

	radius: number;
	iesTexture: DataTexture | null;

}

export class ShapedAreaLight extends RectAreaLight {

	isCircular: boolean;

}

// textures

export class ProceduralEquirectTexture extends DataTexture {

	constructor( width?: number, height?: number );

	generationCallback( polar: Spherical, uv: Vector2, coord: Vector2, color: Color ): void;

	update(): void;

}

export class GradientEquirectTexture extends ProceduralEquirectTexture {

	constructor( resolution?: number );

	exponent: number;
	topColor: Color;
	bottomColor: Color;

}

// materials

export interface FogVolumeMaterialParameters extends MeshStandardMaterialParameters {

	density?: number;
	scatterAnisotropy?: number;

}

export class FogVolumeMaterial extends MeshStandardMaterial {

	constructor( parameters?: FogVolumeMaterialParameters );

	readonly isFogVolumeMaterial: true;

	density: number;
	scatterAnisotropy: number;

}
