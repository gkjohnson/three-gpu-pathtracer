import { RGBAIntegerFormat, IntType } from 'three/webgpu';
import { texture } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { LinearDataTexture, LINEAR_TEXTURE_WIDTH } from '../LinearDataTexture.js';
import { MaterialGraphs } from './MaterialGraphs.js';
import {
	OP, OP_CODE, INPUTS, OUTPUTS, UV_STEP, materialGraphInputStruct, materialGraphResultStruct, getInputCode, getOutputCode,
} from './materialGraph.wgsl.js';

const MAX_REGISTERS = 64;

// an operand register that reads the float in imm in place of a register
const IMMEDIATE_REGISTER = 255;

// The ops the interpreter is always built with, with the rest added as graphs use them, since it runs slower with
// every op built in
const COMMON_OPS = [
	'ADD', 'SUB', 'MUL', 'DIV', 'MIN', 'MAX', 'ABS', 'SIGN', 'FLOOR', 'FRACT', 'SIN', 'COS', 'POW', 'STEP', 'MIX',
	'CLAMP', 'SMOOTHSTEP', 'SELECT', 'COMBINE', 'GT', 'EQ', 'DOT', 'LENGTH', 'NORMALIZE', 'CROSS', 'SWIZZLE', 'INSERT',
];

/**
 * Runs material graphs with an interpreter, so a new graph or an edit doesn't rebuild the shader unless it uses an op
 * or function that's not built in yet. Each instruction is a vec4i in a texture: ( op | dst << 8 | argument count << 16,
 * the first four argument registers a byte each, the next four, imm ).
 */
export class MaterialGraphInterpreter extends MaterialGraphs {

	constructor( options ) {

		super( options );
		this.ops = new Set( COMMON_OPS.map( name => OP[ name ] ) );
		this.programStarts = [];
		this.programsNode = texture( new LinearDataTexture( new Int32Array( 4 ), 4, RGBAIntegerFormat, IntType ) );

	}

	setPrograms( programs ) {

		const { ops, programsNode } = this;
		const opCount = ops.size;
		const words = [];
		this.programStarts = programs.map( instructions => {

			const start = words.length / 4;
			packInstructions( instructions, words );
			instructions.forEach( ( { op } ) => ops.add( op ) );
			return start;

		} );

		programsNode.value.dispose();
		programsNode.value = new LinearDataTexture( new Int32Array( words.length > 0 ? words : 4 ), 4, RGBAIntegerFormat, IntType );
		return ops.size !== opCount;

	}

	getProgramStart( index ) {

		return this.programStarts[ index ];

	}

	getRunFn() {

		const { ops, programsNode, readParameterFn, sampleTexel } = this;
		const callMaterialFunction = this.getCallFn(
			`registers: vec4i, regs: ptr<function, array<vec4f, ${ MAX_REGISTERS }>>`,
			i => `( *regs )[ ( registers[ ${ i >> 2 } ] >> ${ 8 * ( i & 3 ) }u ) & 255 ]`,
		);
		const cases = Object.entries( OP_CODE ).filter( ( [ name ] ) => ops.has( OP[ name ] ) ).map( ( [ name, code ] ) => `case ${ OP[ name ] }: { r = ${ code }; }` ).join( '\n' );
		const inputCases = INPUTS.map( ( name, i ) => `case ${ i }: { r = ${ getInputCode( name ) }; }` ).join( '\n' );
		const outputCases = OUTPUTS.map( ( output, i ) => `case ${ i }: { ${ getOutputCode( output ) } }` ).join( '\n' );

		const readProgram = wgslTagFn/* wgsl */`
			fn readMaterialProgram( index: i32 ) -> vec4i {

				return textureLoad( ${ programsNode }, vec2i( index & ${ LINEAR_TEXTURE_WIDTH - 1 }, index >> ${ Math.log2( LINEAR_TEXTURE_WIDTH ) }u ), 0 );

			}
		`;

		return wgslTagFn/* wgsl */`
			fn runMaterialGraph( start: i32, input: ${ materialGraphInputStruct }, result: ptr<function, ${ materialGraphResultStruct }> ) -> void {

				var regs: array<vec4f, ${ MAX_REGISTERS }>;
				var pc = start;
				loop {

					let instruction = ${ readProgram }( pc );
					pc += 1;

					let op = instruction.x & 255;
					let imm = instruction.w;
					if ( op == ${ OP.END } ) {

						break;

					}

					let immediate = vec4f( bitcast<f32>( imm ) );
					let registers = ( vec3i( instruction.y ) >> vec3u( 0u, 8u, 16u ) ) & vec3i( 255 );
					let a = select( regs[ registers.x ], immediate, registers.x == ${ IMMEDIATE_REGISTER } );
					let b = select( regs[ registers.y ], immediate, registers.y == ${ IMMEDIATE_REGISTER } );
					let c = select( regs[ registers.z ], immediate, registers.z == ${ IMMEDIATE_REGISTER } );

					// every op is a case of its own, since it runs slower with the less common ones tested ahead of it
					var r = vec4f( 0.0 );
					switch ( op ) {

						case ${ OP.CONST }: {

							r = bitcast<vec4f>( ${ readProgram }( pc ) );
							pc += 1;

						}

						case ${ OP.PARAM }: {

							r = ${ readParameterFn }( imm );

						}

						case ${ OP.INPUT }: {

							switch ( imm & 255 ) {

								${ inputCases }
								default: {}

							}

							let step = imm >> 8;
							if ( step != 0 ) {

								let inputIndex = imm & 255;
								if ( inputIndex == ${ INPUTS.indexOf( 'positionLocal' ) } ) {

									r += vec4f( ${ UV_STEP } * select( input.positionLocalDv, input.positionLocalDu, step == 1 ), 0.0 );

								} else if ( inputIndex == ${ INPUTS.indexOf( 'positionWorld' ) } ) {

									r += vec4f( ${ UV_STEP } * select( input.positionWorldDv, input.positionWorldDu, step == 1 ), 0.0 );

								} else {

									r += vec4f( ${ UV_STEP } * select( vec2f( 0.0, 1.0 ), vec2f( 1.0, 0.0 ), step == 1 ), 0.0, 0.0 );

								}

							}

						}

						case ${ OP.OUTPUT }: {

							switch ( imm ) {

								${ outputCases }
								default: {}

							}

							continue;

						}

						case ${ OP.TEXTURE }: {

							r = ${ sampleTexel }( a.xy, imm, 0.0 );

						}

						case ${ OP.CALL }: {

							// the argument registers past the first eight follow
							var callRegisters = vec4i( instruction.yz, 0, 0 );
							if ( ( instruction.x >> 16 ) > 8 ) {

								callRegisters = vec4i( callRegisters.xy, ${ readProgram }( pc ).xy );
								pc += 1;

							}

							r = ${ callMaterialFunction }( imm, callRegisters, &regs, input );

						}

						${ cases }
						default: {}

					}

					regs[ ( instruction.x >> 8 ) & 255 ] = r;

				}

			}
		`;

	}

	dispose() {

		super.dispose();
		this.programsNode.value.dispose();

	}

}

// Packs the instructions onto the end of "words", with their values assigned to registers, which are reused after
// the last read of their value. Without a free register one is taken from a loaded value that's loaded again when
// it's read
function packInstructions( instructions, words ) {

	// the instructions reading each value, in order, found from the last so those of values never read are left out
	const reads = new Map();
	for ( let i = instructions.length - 1; i >= 0; i -- ) {

		const { args, dst, immediate } = instructions[ i ];
		if ( dst !== null && ! reads.has( dst ) ) {

			continue;

		}

		args.forEach( ( arg, k ) => {

			if ( k !== immediate ) {

				reads.set( arg, [ i, ...( reads.get( arg ) ?? [] ) ] );

			}

		} );

	}

	const loads = new Map();
	const registers = new Map();
	const free = Array.from( { length: MAX_REGISTERS }, ( _, i ) => i );

	// assigns a register to the value written ahead of or by instruction "i", keeping the values in "pinned"
	const allocate = ( value, i, pinned = new Set() ) => {

		if ( free.length === 0 ) {

			// take it from the one read again the latest
			let evicted = null;
			let evictedRead = - 1;
			registers.forEach( ( register, other ) => {

				if ( ! loads.has( other ) || pinned.has( other ) ) return;

				const nextRead = reads.get( other ).find( read => read > i );
				if ( nextRead > evictedRead ) {

					evicted = other;
					evictedRead = nextRead;

				}

			} );

			if ( evicted === null ) {

				throw new Error( 'MaterialGraphInterpreter: The graph needs more registers than the interpreter has.' );

			}

			release( evicted );

		}

		free.sort( ( a, b ) => b - a );
		registers.set( value, free.pop() );

	};

	const release = value => {

		free.push( registers.get( value ) );
		registers.delete( value );

	};

	instructions.forEach( ( instruction, i ) => {

		const { op, args, dst, immediate } = instruction;

		// a value that's never read isn't computed
		if ( dst !== null && ! reads.has( dst ) ) {

			return;

		}

		// load the values whose registers were taken
		const pinned = new Set( args.filter( ( arg, k ) => k !== immediate ) );
		pinned.forEach( arg => {

			if ( registers.has( arg ) ) return;
			allocate( arg, i, pinned );
			writeInstruction( words, loads.get( arg ), registers.get( arg ), [] );

		} );

		// release the registers read for the last time, so the result can reuse one
		const argRegisters = args.map( ( arg, k ) => k === immediate ? IMMEDIATE_REGISTER : registers.get( arg ) );
		pinned.forEach( arg => {

			if ( reads.get( arg ).at( - 1 ) === i ) release( arg );

		} );

		if ( dst !== null ) {

			if ( op === OP.CONST || op === OP.INPUT || op === OP.PARAM ) loads.set( dst, instruction );
			allocate( dst, i );

		}

		writeInstruction( words, instruction, registers.get( dst ) ?? 0, argRegisters );

	} );

}

function writeInstruction( words, { op, imm, constant }, dst, args ) {

	// four registers to an int, and the first eight in the instruction
	const packed = [];
	for ( let k = 0; k < Math.max( args.length, 8 ); k += 4 ) {

		const [ a = 0, b = 0, c = 0, d = 0 ] = args.slice( k, k + 4 );
		packed.push( a | ( b << 8 ) | ( c << 16 ) | ( d << 24 ) );

	}

	while ( packed.length % 4 !== 2 ) packed.push( 0 );
	words.push( op | ( dst << 8 ) | ( args.length << 16 ), packed[ 0 ], packed[ 1 ], imm, ...packed.slice( 2 ) );
	if ( op === OP.CONST ) {

		words.push( ...new Int32Array( new Float32Array( constant ).buffer ) );

	}

}
