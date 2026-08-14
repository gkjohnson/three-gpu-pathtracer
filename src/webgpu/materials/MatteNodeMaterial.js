import { MeshBasicNodeMaterial, CustomBlending, AddEquation, OneFactor, ZeroFactor } from 'three/webgpu';
import { vec4 } from 'three/tsl';

// Renders the object as transparent pixels punched into the canvas
export class MatteNodeMaterial extends MeshBasicNodeMaterial {

	static get type() {

		return 'MatteNodeMaterial';

	}

	constructor( parameters ) {

		super();

		this.isMatteNodeMaterial = true;

		// replace the destination instead of blending into it
		// this.transparent = true;
		this.blending = CustomBlending;
		this.blendEquation = AddEquation;
		this.blendSrc = OneFactor;
		this.blendDst = ZeroFactor;
		this.blendEquationAlpha = AddEquation;
		this.blendSrcAlpha = OneFactor;
		this.blendDstAlpha = ZeroFactor;

		this.setValues( parameters );

	}

}
