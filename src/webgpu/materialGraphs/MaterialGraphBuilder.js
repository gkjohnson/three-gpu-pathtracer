import { MaterialGraphs } from './MaterialGraphs.js';
import {
	OP, OP_NAMES, OP_CODE, INPUTS, OUTPUTS, MAX_CALL_ARGUMENTS, UV_STEP, materialGraphInputStruct, materialGraphResultStruct,
	getInputCode, getOutputCode, joinTagFn,
} from './materialGraph.wgsl.js';

/**
 * Runs material graphs as WGSL built from their instructions. It's faster than the interpreter, but the shader is
 * rebuilt whenever a graph changes.
 */
export class MaterialGraphBuilder extends MaterialGraphs {

	constructor( options ) {

		super( options );
		this.instructions = [];
		this.instructionsKey = '';

	}

	setPrograms( programs ) {

		const key = JSON.stringify( programs );
		const changed = key !== this.instructionsKey;
		this.instructions = programs;
		this.instructionsKey = key;
		return changed;

	}

	getProgramStart( index ) {

		return index;

	}

	getRunFn() {

		const { readParameterFn, sampleTexel } = this;
		const callMaterialFunction = this.getCallFn( `args: array<vec4f, ${ MAX_CALL_ARGUMENTS }>`, i => `args[ ${ i } ]` );
		const parts = [
			'fn runMaterialGraph( start: i32, input: ', materialGraphInputStruct,
			', result: ptr<function, ', materialGraphResultStruct, '> ) -> void {\n\nswitch ( start ) {\n\n',
		];

		this.instructions.forEach( ( instructions, index ) => {

			// each instruction writes a variable of its own, with its operands named as in "OP_CODE"
			parts.push( `case ${ index }: {\n` );
			instructions.forEach( ( { op, dst, args, imm, constant, immediate } ) => {

				if ( op === OP.END ) {

					return;

				}

				const operands = [ 'a', 'b', 'c' ].map( ( name, k ) => {

					return `let ${ name } = ${ k === immediate ? 'vec4f( bitcast<f32>( imm ) )' : k < args.length ? `v${ args[ k ] }` : 'vec4f( 0.0 )' };`;

				} ).join( ' ' );

				if ( dst !== null ) {

					parts.push( `var v${ dst }: vec4f;\n` );

				}

				parts.push( `{ let imm = i32( ${ imm } ); ${ operands } ` );
				if ( op === OP.OUTPUT ) {

					parts.push( getOutputCode( OUTPUTS[ imm ] ) );

				} else if ( op === OP.CONST ) {

					parts.push( `v${ dst } = bitcast<vec4f>( vec4i( ${ new Int32Array( new Float32Array( constant ).buffer ).join( ', ' ) } ) );` );

				} else if ( op === OP.PARAM ) {

					parts.push( `v${ dst } = `, readParameterFn, '( imm );' );

				} else if ( op === OP.INPUT ) {

					const name = INPUTS[ imm & 255 ];
					const axis = [ null, 'u', 'v' ][ imm >> 8 ];
					const step = axis === null ? 'vec4f( 0.0 )' :
						/^position/.test( name ) ? `vec4f( input.${ name }D${ axis }, 0.0 )` :
							`vec4f( ${ axis === 'u' ? '1.0, 0.0' : '0.0, 1.0' }, 0.0, 0.0 )`;
					parts.push( `v${ dst } = ${ getInputCode( name ) } + ${ UV_STEP } * ${ step };` );

				} else if ( op === OP.TEXTURE ) {

					parts.push( `v${ dst } = `, sampleTexel, '( a.xy, imm, 0.0 );' );

				} else if ( op === OP.CALL ) {

					const callArgs = Array.from( { length: MAX_CALL_ARGUMENTS }, ( _, k ) => k < args.length ? `v${ args[ k ] }` : 'vec4f( 0.0 )' );
					parts.push( `v${ dst } = `, callMaterialFunction, `( imm, array<vec4f, ${ MAX_CALL_ARGUMENTS }>( ${ callArgs.join( ', ' ) } ), input );` );

				} else {

					parts.push( `v${ dst } = ${ OP_CODE[ OP_NAMES[ op ] ] };` );

				}

				parts.push( ' }\n' );

			} );

			parts.push( '}\n' );

		} );

		parts.push( 'default: {}\n\n}\n\n}\n' );
		return joinTagFn( parts );

	}

}
