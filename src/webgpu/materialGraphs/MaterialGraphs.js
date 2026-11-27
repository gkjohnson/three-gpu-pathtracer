/** @import { Material, Object3D, Texture } from 'three/webgpu' */
import { RGBAFormat, FloatType } from 'three/webgpu';
import { texture } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { LinearDataTexture } from '../LinearDataTexture.js';
import { MaterialGraphCompiler, getValueLanes } from './MaterialGraphCompiler.js';
import { getCallMaterialFunctionFn } from './materialGraph.wgsl.js';

/**
 * Base class for running the TSL graphs of node materials in a shader. Call `update` with the materials, write the
 * programs from `getPrograms` where the shader can read them, and run them with the WGSL function from `getRunFn`:
 *
 * `fn runMaterialGraph( program: i32, input: MaterialGraphInput, result: ptr<function, MaterialGraphResult> )`
 *
 * It overwrites the fields of the result that the material has graphs for.
 *
 * @param {Object} options
 * @param {Function} options.sampleTexel - WGSL function sampling a texture, `( uv, descriptor, lod ) -> vec4f`.
 * @param {function(Texture):number} options.getTextureDescriptor - Returns the descriptor to sample a texture with.
 */
export class MaterialGraphs {

	constructor( { sampleTexel, getTextureDescriptor } ) {

		this.sampleTexel = sampleTexel;
		this.getTextureDescriptor = getTextureDescriptor;
		this.compiler = new MaterialGraphCompiler();

		// the index of each material's programs, and the values of the graphs' uniforms
		this.programs = new Map();
		this.parametersNode = texture( new LinearDataTexture( new Float32Array( 4 ), 4, RGBAFormat, FloatType ) );
		this.functionKeys = null;

		const { parametersNode } = this;
		this.readParameterFn = wgslTagFn/* wgsl */`
			fn readMaterialParameter( index: i32 ) -> vec4f {

				let width = i32( textureDimensions( ${ parametersNode } ).x );
				return textureLoad( ${ parametersNode }, vec2i( index % width, index / width ), 0 );

			}
		`;

	}

	/**
	 * Compiles the graphs of the materials, replacing those of the last update. Returns whether the function from
	 * `getRunFn` changed. "getObject" returns an object drawn with a material, which custom nodes may read.
	 *
	 * @param {Array<Material>} materials
	 * @param {function(Material):Object3D} [getObject]
	 * @returns {boolean}
	 */
	update( materials, getObject = () => null ) {

		const { compiler, programs, parametersNode } = this;
		const getTextureDescriptor = node => this.getTextureDescriptor( node.value );

		// the index of the first vec4 of each uniform's value, matrices taking one per column
		const parameters = new Map();
		let parameterCount = 0;
		const getParameterIndex = node => {

			if ( ! parameters.has( node ) ) {

				parameters.set( node, parameterCount );
				parameterCount += getValueLanes( node.value ).length / 4;

			}

			return parameters.get( node );

		};

		// only the functions the current graphs call are generated
		compiler.resetFunctions();

		const programList = [];
		programs.clear();
		materials.forEach( material => {

			if ( compiler.hasGraph( material ) ) {

				const { program, opacityProgram, emissionProgram } = compiler.compile( material, getTextureDescriptor, getParameterIndex, getObject( material ) );
				programs.set( material, {
					program: programList.push( program ) - 1,
					opacityProgram: opacityProgram ? programList.push( opacityProgram ) - 1 : - 1,
					emissionProgram: emissionProgram ? programList.push( emissionProgram ) - 1 : - 1,
				} );

			}

		} );

		const parametersData = new Float32Array( Math.max( parameterCount, 1 ) * 4 );
		parameters.forEach( ( index, node ) => parametersData.set( getValueLanes( node.value ), index * 4 ) );
		parametersNode.value.dispose();
		parametersNode.value = new LinearDataTexture( parametersData, 4, RGBAFormat, FloatType );

		// the generated functions are part of the function from "getRunFn", so it changes when they do
		const programsChanged = this.setPrograms( programList );
		const functionKeys = [ ...compiler.functionsMap.keys() ];
		const { functionKeys: previousKeys } = this;
		const functionsChanged = previousKeys === null || functionKeys.length !== previousKeys.length || functionKeys.some( ( key, i ) => key !== previousKeys[ i ] );
		this.functionKeys = functionKeys;
		return programsChanged || functionsChanged;

	}

	/**
	 * Returns the material's programs to run, one writing all its graphs' outputs, one only the opacity and one only the
	 * emission, or -1 without one.
	 *
	 * @param {Material} material
	 * @returns {{program:number,opacityProgram:number,emissionProgram:number}}
	 */
	getPrograms( material ) {

		const { program = - 1, opacityProgram = - 1, emissionProgram = - 1 } = this.programs.get( material ) ?? {};
		return {
			program: program === - 1 ? - 1 : this.getProgramStart( program ),
			opacityProgram: opacityProgram === - 1 ? - 1 : this.getProgramStart( opacityProgram ),
			emissionProgram: emissionProgram === - 1 ? - 1 : this.getProgramStart( emissionProgram ),
		};

	}

	/**
	 * Returns the WGSL function running a program. Get it again when `update` returns true.
	 */
	getRunFn() {}

	// Prepares the programs, lists of instructions, to run. Returns whether the function from "getRunFn" changed
	setPrograms( /* programs */ ) {}

	// the value the function from "getRunFn" takes to run the program at the index
	getProgramStart( /* index */ ) {}

	// the WGSL function calling the generated functions, with the arguments read from "params" by "getArg( i )"
	getCallFn( params, getArg ) {

		return getCallMaterialFunctionFn( this.compiler.functions, params, getArg );

	}

	dispose() {

		this.parametersNode.value.dispose();

	}

}
