import { StructTypeNode, VaryingNode } from 'three/webgpu';
import {
	Fn, context, expression, overrideNodes, normalLocal as normalLocalNode, float, int, uint, vec2, vec3, vec4, ivec2, ivec3,
	ivec4, uvec2, uvec3, uvec4,
} from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// The instructions node material TSL graphs, such as those from three's MaterialXLoader, are compiled to by
// "MaterialGraphCompiler", and the WGSL of each op. TSL functions the ops can't express, like the MaterialX noises, and
// nodes without ops are generated into WGSL functions the instructions call by index.

// TODO: three.js only inlines varyings in the fragment stage with "inlineVaryings", so a generated function
// reading a varying like "positionLocal" in a compute shader emits an undeclared variable. Inline them in the
// compute stage too until three.js supports it
const _varyingSetup = VaryingNode.prototype.setup;
VaryingNode.prototype.setup = function ( builder ) {

	if ( builder.context.inlineVaryings === true && builder.shaderStage === 'compute' ) {

		return this.node;

	}

	return _varyingSetup.call( this, builder );

};

export const MAX_CALL_ARGUMENTS = 16;

// the texture coordinate step a height is read at to find its slope. An "INPUT" op reading a uv or position
// with ( imm >> 8 ) of 1 or 2 reads it one step along u or v over the surface
export const UV_STEP = 1 / 1024;

// The ops, whose values are vec4f, with ints and bools stored as floats. "imm" is an op specific int
export const OP_NAMES = [
	'END', 'CONST', 'INPUT', 'OUTPUT', 'TEXTURE', 'CALL',

	// reads the uniform value at index imm of the parameters
	'PARAM',

	// unary
	'ABS', 'SIGN', 'FLOOR', 'CEIL', 'ROUND', 'TRUNC', 'FRACT', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN',
	'SINH', 'COSH', 'TANH', 'EXP', 'EXP2', 'LOG', 'LOG2', 'SQRT', 'INVERSE_SQRT', 'NEGATE', 'ONE_MINUS',
	'RECIPROCAL', 'RADIANS', 'DEGREES', 'NOT', 'TO_BOOL',

	// binary
	'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'MOD_TRUNC', 'MIN', 'MAX', 'POW', 'STEP', 'ATAN2', 'DIFFERENCE',
	'LT', 'LE', 'GT', 'GE', 'EQ', 'NE', 'AND', 'OR', 'XOR',

	// ternary
	'MIX', 'CLAMP', 'SMOOTHSTEP', 'SELECT',

	// joins two or three floats into a vector
	'COMBINE',

	// vector ops reading the component count from imm
	'DOT', 'LENGTH', 'DISTANCE', 'NORMALIZE', 'ALL', 'ANY', 'REFLECT', 'REFRACT', 'CROSS',

	// "SWIZZLE" packs the four source lanes of imm in 2 bits each. "INSERT" copies b's first ( imm >> 2 ) lanes
	// into a at lane ( imm & 3 ). "ELEMENT" reads the lane of a that b indexes
	'SWIZZLE', 'INSERT', 'ELEMENT',

	// a vec4 transformed by the camera's view or world matrix, or by the object's world or normal matrix
	'VIEW_MATRIX', 'CAMERA_WORLD_MATRIX', 'MODEL_WORLD_MATRIX', 'MODEL_NORMAL_MATRIX',
];

export const OP = Object.fromEntries( OP_NAMES.map( ( name, i ) => [ name, i ] ) );

// the values an "INPUT" op reads, from "MaterialGraphInput". "cameraPosition" is one unit back along the view
// direction, since every path vertex has its own
export const INPUTS = [ 'uv', 'uv1', 'positionLocal', 'normalLocal', 'positionWorld', 'normalWorld', 'tangentWorld', 'bitangentWorld', 'cameraPosition', 'color' ];

// the surface inputs an "OUTPUT" op writes: the "MaterialGraphResult" field, its type, and the node material
// property holding its graph
export const OUTPUTS = [
	[ 'color', 'vec3', 'colorNode' ],
	[ 'opacity', 'float', 'opacityNode' ],
	[ 'roughness', 'float', 'roughnessNode' ],
	[ 'metalness', 'float', 'metalnessNode' ],
	[ 'emission', 'vec3', 'emissiveNode' ],
	[ 'normal', 'vec3', 'normalNode' ],
	[ 'specularColor', 'vec3', 'specularColorNode' ],
	[ 'specularIntensity', 'float', 'specularIntensityNode' ],
	[ 'ior', 'float', 'iorNode' ],
	[ 'transmission', 'float', 'transmissionNode' ],
	[ 'clearcoat', 'float', 'clearcoatNode' ],
	[ 'clearcoatRoughness', 'float', 'clearcoatRoughnessNode' ],
	[ 'clearcoatNormal', 'vec3', 'clearcoatNormalNode' ],
	[ 'sheenColor', 'vec3', 'sheenNode' ],
	[ 'sheenRoughness', 'float', 'sheenRoughnessNode' ],
	[ 'iridescence', 'float', 'iridescenceNode' ],
	[ 'iridescenceIor', 'float', 'iridescenceIORNode' ],
	[ 'iridescenceThickness', 'float', 'iridescenceThicknessNode' ],
	[ 'dispersion', 'float', 'dispersionNode' ],
	[ 'anisotropy', 'vec2', 'anisotropyNode' ],
	[ 'alphaTest', 'float', 'alphaTestNode' ],
];

export const materialGraphInputStruct = new StructTypeNode( {
	uv: 'vec2f',
	uv1: 'vec2f',
	positionLocal: 'vec3f',
	normalLocal: 'vec3f',
	positionWorld: 'vec3f',
	normalWorld: 'vec3f',
	tangentWorld: 'vec3f',
	bitangentWorld: 'vec3f',
	view: 'vec3f',
	color: 'vec4f',

	// the change of the position along the surface per unit of uv
	positionLocalDu: 'vec3f',
	positionLocalDv: 'vec3f',
	positionWorldDu: 'vec3f',
	positionWorldDv: 'vec3f',

	// the object and vertex colors tinting the color and opacity outputs
	tint: 'vec4f',

	// the matrices of view space, the render camera's like three.js, and of the object. The normal matrix only
	// transforms directions
	viewMatrix: 'mat4x4f',
	cameraWorldMatrix: 'mat4x4f',
	modelWorldMatrix: 'mat4x4f',
	modelNormalMatrix: 'mat4x4f',
}, 'MaterialGraphInput' );

// the surface inputs, initialized from the material's properties and written over by the graph outputs. "sheen"
// is set when a graph writes the sheen color, since node materials set the sheen through it
export const materialGraphResultStruct = new StructTypeNode( {
	...Object.fromEntries( OUTPUTS.map( ( [ name, type ] ) => [ name, { vec3: 'vec3f', vec2: 'vec2f', float: 'float' }[ type ] ] ) ),
	sheen: 'float',
}, 'MaterialGraphResult' );

const LANE_MASK = 'select( vec4f( 0.0 ), vec4f( 1.0 ), vec4u( 0u, 1u, 2u, 3u ) < vec4u( u32( imm ) ) )';

// zeroes the lanes past the component count, which can hold NaN
const maskLanes = value => `select( vec4f( 0.0 ), ${ value }, vec4u( 0u, 1u, 2u, 3u ) < vec4u( u32( imm ) ) )`;

// the WGSL expression computing each op's result from the operands "a", "b" and "c" and "imm"
export const OP_CODE = {
	ABS: 'abs( a )',
	SIGN: 'sign( a )',
	FLOOR: 'floor( a )',
	CEIL: 'ceil( a )',
	ROUND: 'round( a )',
	TRUNC: 'trunc( a )',
	FRACT: 'fract( a )',
	SIN: 'sin( a )',
	COS: 'cos( a )',
	TAN: 'tan( a )',
	ASIN: 'asin( a )',
	ACOS: 'acos( a )',
	ATAN: 'atan( a )',
	SINH: 'sinh( a )',
	COSH: 'cosh( a )',
	TANH: 'tanh( a )',
	EXP: 'exp( a )',
	EXP2: 'exp2( a )',
	LOG: 'log( a )',
	LOG2: 'log2( a )',
	SQRT: 'sqrt( a )',
	INVERSE_SQRT: 'inverseSqrt( a )',
	NEGATE: '- a',
	ONE_MINUS: '1.0 - a',
	RECIPROCAL: '1.0 / a',
	RADIANS: 'radians( a )',
	DEGREES: 'degrees( a )',
	NOT: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a == vec4f( 0.0 ) )',
	TO_BOOL: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a != vec4f( 0.0 ) )',

	ADD: 'a + b',
	SUB: 'a - b',
	MUL: 'a * b',
	DIV: 'a / b',
	MOD: 'a - b * floor( a / b )',
	MOD_TRUNC: 'a - b * trunc( a / b )',
	MIN: 'min( a, b )',
	MAX: 'max( a, b )',
	POW: 'pow( a, b )',
	STEP: 'step( a, b )',
	ATAN2: 'atan2( a, b )',
	DIFFERENCE: 'abs( a - b )',
	LT: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a < b )',
	LE: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a <= b )',
	GT: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a > b )',
	GE: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a >= b )',
	EQ: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a == b )',
	NE: 'select( vec4f( 0.0 ), vec4f( 1.0 ), a != b )',
	AND: 'select( vec4f( 0.0 ), vec4f( 1.0 ), ( a != vec4f( 0.0 ) ) & ( b != vec4f( 0.0 ) ) )',
	OR: 'select( vec4f( 0.0 ), vec4f( 1.0 ), ( a != vec4f( 0.0 ) ) | ( b != vec4f( 0.0 ) ) )',
	XOR: 'select( vec4f( 0.0 ), vec4f( 1.0 ), ( a != vec4f( 0.0 ) ) != ( b != vec4f( 0.0 ) ) )',

	MIX: 'mix( a, b, c )',
	CLAMP: 'clamp( a, b, c )',
	SMOOTHSTEP: 'smoothstep( a, b, c )',
	SELECT: 'select( c, b, a != vec4f( 0.0 ) )',

	COMBINE: 'vec4f( a.x, b.x, c.x, 0.0 )',

	DOT: `vec4f( dot( ${ maskLanes( 'a' ) }, ${ maskLanes( 'b' ) } ) )`,
	LENGTH: `vec4f( length( ${ maskLanes( 'a' ) } ) )`,
	DISTANCE: `vec4f( length( ${ maskLanes( 'a - b' ) } ) )`,
	NORMALIZE: `normalize( ${ maskLanes( 'a' ) } )`,
	ALL: `vec4f( select( 0.0, 1.0, dot( select( vec4f( 0.0 ), vec4f( 1.0 ), a != vec4f( 0.0 ) ), ${ LANE_MASK } ) == f32( imm ) ) )`,
	ANY: `vec4f( select( 0.0, 1.0, dot( select( vec4f( 0.0 ), vec4f( 1.0 ), a != vec4f( 0.0 ) ), ${ LANE_MASK } ) > 0.0 ) )`,
	REFLECT: `a - 2.0 * dot( ${ maskLanes( 'b' ) }, ${ maskLanes( 'a' ) } ) * b`,
	REFRACT: 'vec4f( refract( a.xyz, b.xyz, c.x ), 0.0 )',
	CROSS: 'vec4f( cross( a.xyz, b.xyz ), 0.0 )',

	SWIZZLE: 'vec4f( a[ imm & 3 ], a[ ( imm >> 2 ) & 3 ], a[ ( imm >> 4 ) & 3 ], a[ ( imm >> 6 ) & 3 ] )',
	INSERT: 'select( a, vec4f( b[ ( 4 - ( imm & 3 ) ) & 3 ], b[ ( 5 - ( imm & 3 ) ) & 3 ], b[ ( 6 - ( imm & 3 ) ) & 3 ], b[ ( 7 - ( imm & 3 ) ) & 3 ] ), ( vec4i( 0, 1, 2, 3 ) >= vec4i( imm & 3 ) ) & ( vec4i( 0, 1, 2, 3 ) < vec4i( ( imm & 3 ) + ( imm >> 2 ) ) ) )',
	ELEMENT: 'vec4f( a[ clamp( i32( b.x ), 0, 3 ) ] )',

	VIEW_MATRIX: 'input.viewMatrix * a',
	CAMERA_WORLD_MATRIX: 'input.cameraWorldMatrix * a',
	MODEL_WORLD_MATRIX: 'input.modelWorldMatrix * a',
	MODEL_NORMAL_MATRIX: 'input.modelNormalMatrix * a',
};

// the vec4f an "INPUT" op reads
export function getInputCode( name ) {

	return name === 'cameraPosition' ? 'vec4f( input.positionWorld + input.view, 0.0 )' :
		name === 'color' ? 'input.color' :
			name === 'uv' || name === 'uv1' ? `vec4f( input.${ name }, 0.0, 0.0 )` :
				`vec4f( input.${ name }, 0.0 )`;

}

// the statement an "OUTPUT" op writes "a" with
export function getOutputCode( [ name, type ] ) {

	let value = { vec3: 'a.xyz', vec2: 'a.xy', float: 'a.x' }[ type ];

	// normal graphs are in view space, as in three.js, and the surface's normals in world space
	if ( name === 'normal' || name === 'clearcoatNormal' ) value = '( input.cameraWorldMatrix * vec4f( a.xyz, 0.0 ) ).xyz';
	if ( name === 'color' ) value += ' * input.tint.rgb';
	if ( name === 'opacity' ) value += ' * input.tint.a';

	const sheen = name === 'sheenColor' ? ' result.sheen = 1.0;' : '';
	return `result.${ name } = ${ value };${ sheen }`;

}

// converts a vec4f function argument to the type of a TSL function input
function fromVec4( node, type ) {

	switch ( type ) {

		case 'float': return node.x;
		case 'int': return int( node.x );
		case 'uint': return uint( node.x );
		case 'bool': return node.x.notEqual( 0 );
		case 'vec2': return node.xy;
		case 'vec3': case 'color': return node.xyz;
		case 'vec4': return node;
		case 'ivec2': return ivec2( node.xy );
		case 'ivec3': return ivec3( node.xyz );
		case 'ivec4': return ivec4( node );
		case 'uvec2': return uvec2( node.xy );
		case 'uvec3': return uvec3( node.xyz );
		case 'uvec4': return uvec4( node );
		default: throw new Error( `MaterialGraph: Unsupported function input type "${ type }".` );

	}

}

// converts a TSL value of the given component count to a vec4f register
function toVec4( node, length ) {

	switch ( length ) {

		case 1: return vec4( float( node ), 0, 0, 0 );
		case 2: return vec4( vec2( node ), 0, 0 );
		case 3: return vec4( vec3( node ), 0 );
		default: return vec4( node );

	}

}

// joins code strings and nodes into a "wgslTagFn", for code with a variable number of nodes
export function joinTagFn( parts ) {

	const tokens = [ '' ];
	const args = [];
	for ( const part of parts ) {

		if ( typeof part === 'string' ) {

			tokens[ tokens.length - 1 ] += part;

		} else {

			args.push( part );
			tokens.push( '' );

		}

	}

	return wgslTagFn( tokens, ...args );

}

/**
 * Returns the WGSL function the "CALL" op runs, calling the generated function at "index" in "functions":
 * `fn callMaterialFunction( index: i32, <params>, input: MaterialGraphInput ) -> vec4f`
 *
 * "getArg( i )" returns the WGSL reading the vec4f argument "i" from "params". Each entry of "functions" has
 * "argTypes", the "length" of its result and "build( args )" returning the TSL node from the converted arguments.
 */
export function getCallMaterialFunctionFn( functions, params, getArg ) {

	const parts = [
		`fn callMaterialFunction( index: i32, ${ params }, input: `,
		materialGraphInputStruct,
		' ) -> vec4f {\n\nswitch ( index ) {\n\n',
	];

	functions.forEach( ( { argTypes, length, build }, index ) => {

		// the node's "uv", "position", "normal" and "color" attributes read the hit's, and textures are
		// sampled at the top level since there are no derivatives in a compute shader
		const fn = Fn( ( inputs ) => {

			const params = [ ...inputs ];
			const [ uv, uv1, position, normal, color ] = params.slice( argTypes.length );
			const attributes = { uv, uv1, position, normal, color };
			const args = argTypes.map( ( type, i ) => fromVec4( params[ i ], type ) );

			// "normalLocal" reads the geometry, which a compute shader has none of
			const result = overrideNodes( [[ normalLocalNode, normal ]], toVec4( build( args ), length ) );
			return context( result, {
				getAttribute: name => attributes[ name ] ?? null,
				getTextureLevel: () => float( 0 ),
				inlineVaryings: true,
			} );

		} ).setLayout( {
			name: `materialFunction${ index }`,
			type: 'vec4',
			inputs: [
				...argTypes.map( ( type, i ) => ( { name: `a${ i }`, type: 'vec4' } ) ),
				{ name: 'uv', type: 'vec2' },
				{ name: 'uv1', type: 'vec2' },
				{ name: 'position', type: 'vec3' },
				{ name: 'normal', type: 'vec3' },
				{ name: 'color', type: 'vec4' },
			],
		} );

		const call = fn(
			...argTypes.map( ( type, i ) => expression( getArg( i ), 'vec4' ) ),
			expression( 'input.uv', 'vec2' ),
			expression( 'input.uv1', 'vec2' ),
			expression( 'input.positionLocal', 'vec3' ),
			expression( 'input.normalLocal', 'vec3' ),
			expression( 'input.color', 'vec4' ),
		);

		parts.push( `case ${ index }: { return `, call, '; }\n' );

	} );

	parts.push( 'default: { return vec4f( 0.0 ); }\n\n}\n\n}\n' );
	return joinTagFn( parts );

}
