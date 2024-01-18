import { Mesh, BoxGeometry, PerspectiveCamera } from 'three';

// Returns whether a material can be compiled and run on the current device or not
export class MaterialCompileDetector {

	constructor( renderer ) {

		this._renderer = renderer;

	}

	detect( material ) {

		const renderer = this._renderer;
		const mesh = new Mesh( new BoxGeometry(), material );
		const camera = new PerspectiveCamera();
		const ogShaderErrors = renderer.debug.checkShaderErrors;
		renderer.debug.checkShaderErrors = true;

		const programs = renderer.info.programs;
		const progLength = programs.length;
		renderer.compile( mesh, camera );

		renderer.debug.checkShaderErrors = ogShaderErrors;
		mesh.geometry.dispose();

		if ( programs.length === progLength ) {

			return {
				detail: null,
				pass: true,
				message: 'Cannot determine shader compilation status if material has already been used.',
			};

		} else {

			const program = programs[ programs.length - 1 ];
			const pass = program.diagnostics ? program.diagnostics.runnable : true;
			const message = pass ? '' : `Cannot render ${ material.type } on this device.`;
			return {
				detail: {},
				pass,
				message,
			};

		}

	}

}
