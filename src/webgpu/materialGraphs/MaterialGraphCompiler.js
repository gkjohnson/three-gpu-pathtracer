/** @import { Node, NodeMaterial, Object3D, Color, Vector3 } from 'three/webgpu' */
import { Matrix3, Vector3, NodeBuilder, TangentSpaceNormalMap } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { OP, INPUTS, OUTPUTS, MAX_CALL_ARGUMENTS } from './materialGraph.wgsl.js';

const {
	positionLocal, positionGeometry, normalLocal, normalGeometry, positionWorld, normalWorld, normalWorldGeometry,
	tangentWorld, bitangentWorld, cameraPosition, transformNormalToView,
	normalView, normalViewGeometry, positionView, positionViewDirection, tangentView, bitangentView,
	cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, modelWorldMatrix, modelNormalMatrix, modelViewMatrix,
} = TSL;

// the view space accessors, from the world space value and its "w": 1 for a point, 0 for a direction. View space is
// the render camera's, as in three.js
const VIEW_ACCESSORS = new Map( [
	[ normalView, [ normalWorld, 0 ]],
	[ normalViewGeometry, [ normalWorld, 0 ]],
	[ tangentView, [ tangentWorld, 0 ]],
	[ bitangentView, [ bitangentWorld, 0 ]],
	[ positionView, [ positionWorld, 1 ]],
	[ positionViewDirection, [ /* @__PURE__ */ cameraPosition.sub( positionWorld ).normalize(), 0 ]],
] );

// the matrices a vector can be multiplied by: the ops applying them in order, and the matrix type
const MATRICES = new Map( [
	[ cameraViewMatrix, [[ 'VIEW_MATRIX' ], 'mat4' ]],
	[ cameraWorldMatrix, [[ 'CAMERA_WORLD_MATRIX' ], 'mat4' ]],
	[ cameraNormalMatrix, [[ 'VIEW_MATRIX' ], 'mat3' ]],
	[ modelWorldMatrix, [[ 'MODEL_WORLD_MATRIX' ], 'mat4' ]],
	[ modelNormalMatrix, [[ 'MODEL_NORMAL_MATRIX' ], 'mat3' ]],
	[ modelViewMatrix, [[ 'MODEL_WORLD_MATRIX', 'VIEW_MATRIX' ], 'mat4' ]],
] );

// the TSL accessors read from the hit
const ACCESSORS = new Map( [
	[ positionLocal, 'positionLocal' ],
	[ positionGeometry, 'positionLocal' ],
	[ normalLocal, 'normalLocal' ],
	[ normalGeometry, 'normalLocal' ],
	[ positionWorld, 'positionWorld' ],
	[ normalWorld, 'normalWorld' ],
	[ normalWorldGeometry, 'normalWorld' ],
	[ tangentWorld, 'tangentWorld' ],
	[ bitangentWorld, 'bitangentWorld' ],
	[ cameraPosition, 'cameraPosition' ],
] );

const ATTRIBUTES = {
	uv: [ 'uv', 'vec2' ],
	uv1: [ 'uv1', 'vec2' ],
	position: [ 'positionLocal', 'vec3' ],
	normal: [ 'normalLocal', 'vec3' ],
	color: [ 'color', 'vec4' ],
};

const INPUT_TYPES = {
	uv: 'vec2', uv1: 'vec2', positionLocal: 'vec3', normalLocal: 'vec3', positionWorld: 'vec3', normalWorld: 'vec3',
	tangentWorld: 'vec3', bitangentWorld: 'vec3', cameraPosition: 'vec3', color: 'vec4',
};

const UNARY_METHODS = {
	abs: 'ABS', sign: 'SIGN', floor: 'FLOOR', ceil: 'CEIL', round: 'ROUND', trunc: 'TRUNC', fract: 'FRACT',
	sin: 'SIN', cos: 'COS', tan: 'TAN', asin: 'ASIN', acos: 'ACOS', sinh: 'SINH', cosh: 'COSH', tanh: 'TANH',
	exp: 'EXP', exp2: 'EXP2', log: 'LOG', log2: 'LOG2', sqrt: 'SQRT', inversesqrt: 'INVERSE_SQRT',
	negate: 'NEGATE', oneMinus: 'ONE_MINUS', reciprocal: 'RECIPROCAL', radians: 'RADIANS', degrees: 'DEGREES',
};

const BINARY_METHODS = {
	min: 'MIN', max: 'MAX', pow: 'POW', step: 'STEP', difference: 'DIFFERENCE',
};

const TERNARY_METHODS = { mix: 'MIX', clamp: 'CLAMP', smoothstep: 'SMOOTHSTEP' };

const OPERATORS = {
	'+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD',
	'<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE', '==': 'EQ', '!=': 'NE', '&&': 'AND', '||': 'OR', '^^': 'XOR',
};

const COMPARISONS = new Set( [ '<', '<=', '>', '>=', '==', '!=' ] );

const LANES = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

// the TSL functions called as a whole rather than expanded into ops
const WHOLE_FUNCTIONS = [
	'mx_noise_float', 'mx_noise_vec3', 'mx_noise_vec4', 'mx_cell_noise_float', 'mx_cell_noise_vec3',
	'mx_fractal_noise_float_2d', 'mx_fractal_noise_float', 'mx_fractal_noise_vec2', 'mx_fractal_noise_vec3', 'mx_fractal_noise_vec4',
	'mx_worley_noise_float_2d', 'mx_worley_noise_float_3d', 'mx_worley_noise_float', 'mx_worley_noise_vec2', 'mx_worley_noise_vec3',
	'mx_worley_noise_vec3_style', 'mx_unifiednoise2d', 'mx_unifiednoise3d',
	'mx_hsvtorgb', 'mx_rgbtohsv', 'mx_srgb_texture_to_lin_rec709',
];

const _identity = /* @__PURE__ */ new Matrix3();

class UnsupportedError extends Error {}

// stands in for the node builder a function's body can read, which there is none of here
const _builder = /* @__PURE__ */ new Proxy( {
	subBuildFn: null,
	fnCall: null,
	getNodeProperties: () => ( {} ),
	getClosestSubBuild: () => null,
}, {
	get: ( target, key ) => key in target ? target[ key ] : unsupported( 'node builder access' ),
} );

// some node classes have no "is*" flag
function isType( node, type ) {

	return node.constructor.type === type;

}

function unsupported( message ) {

	throw new UnsupportedError( message );

}

// adds the shader nodes of the layout functions called in the graph of "root" to "target"
function collectLayoutFunctions( root, target ) {

	const seen = new Set();
	const traverse = node => {

		if ( ! node || ! node.isNode || seen.has( node ) ) {

			return;

		}

		seen.add( node );

		if ( node.isShaderCallNodeInternal && node.shaderNode.layout ) {

			target.add( node.shaderNode );

		} else if ( node.functionNodes ) {

			node.functionNodes.forEach( fn => target.add( fn.shaderNode ) );

		}

		if ( node.isShaderCallNodeInternal ) {

			( Array.isArray( node.rawInputs ) ? node.rawInputs : [] ).forEach( traverse );

		} else {

			for ( const child of node.getChildren() ) {

				traverse( child );

			}

		}

	};

	traverse( root );

}

// type helpers, with "color" as vec3
function getLength( type ) {

	if ( type === 'float' || type === 'int' || type === 'uint' || type === 'bool' ) return 1;
	const match = /^[biu]?vec([234])$/.exec( type );
	if ( match ) return Number( match[ 1 ] );
	if ( type === 'color' ) return 3;
	return unsupported( `type "${ type }"` );

}

function getComponentType( type ) {

	if ( type === 'color' ) return 'float';
	if ( /^(float|int|uint|bool)$/.test( type ) ) return type;
	const prefix = type[ 0 ];
	return prefix === 'b' ? 'bool' : prefix === 'i' ? 'int' : prefix === 'u' ? 'uint' : 'float';

}

function getType( length, componentType ) {

	if ( length === 1 ) return componentType;
	const prefix = { float: '', int: 'i', uint: 'u', bool: 'b' }[ componentType ];
	return `${ prefix }vec${ length }`;

}

function getValueType( value ) {

	if ( typeof value === 'number' ) return 'float';
	if ( typeof value === 'boolean' ) return 'bool';
	if ( value && value.isColor ) return 'color';
	if ( value && value.isVector2 ) return 'vec2';
	if ( value && value.isVector3 ) return 'vec3';
	if ( value && value.isVector4 ) return 'vec4';
	if ( value && value.isMatrix3 ) return 'mat3';
	if ( value && value.isMatrix4 ) return 'mat4';
	return unsupported( `constant value "${ value && value.constructor.name }"` );

}

/**
 * Returns the value of a constant or uniform node, or null if the node is a graph.
 *
 * @param {Node} node
 * @returns {number|Color|Vector3|null}
 */
export function getConstantNodeValue( node ) {

	while ( node && isType( node, 'ConvertNode' ) ) {

		node = node.node;

	}

	return node && ( node.isConstNode || ( node.isUniformNode && ! node.isTextureNode ) ) ? node.value : null;

}

// returns the lanes of a value, four per vec4 it's stored in: one, or one per column of a matrix
export function getValueLanes( value ) {

	if ( typeof value === 'number' ) return [ value, value, value, value ];
	if ( typeof value === 'boolean' ) return [ Number( value ), 0, 0, 0 ];
	if ( value.isColor ) return [ value.r, value.g, value.b, 0 ];
	if ( value.isMatrix4 ) return [ ...value.elements ];
	if ( value.isMatrix3 ) {

		const e = value.elements;
		return [ e[ 0 ], e[ 1 ], e[ 2 ], 0, e[ 3 ], e[ 4 ], e[ 5 ], 0, e[ 6 ], e[ 7 ], e[ 8 ], 0 ];

	}

	return [ value.x, value.y, value.z ?? 0, value.w ?? 0 ];

}

// constant and uniform nodes without a type are weak, adapting to the other operands as in TSL
function isWeak( node ) {

	return ( node.isConstNode || node.isUniformNode ) && ! node.nodeType && typeof node.value === 'number';

}

// the declared type of a TSL function's result, or null
function getFunctionType( shaderNode ) {

	return shaderNode.layout ? shaderNode.layout.type : shaderNode.nodeType;

}

// inputs can be passed as an object of named parameters
function isObjectInput( inputs ) {

	return inputs.length === 1 && inputs[ 0 ]?.constructor === Object;

}

// evaluates the body of a TSL function with the inputs converted to the layout's types, returning its result and
// whether it's only an expression, without loops, branches or assigned variables
function expandFunction( shaderNode, inputs ) {

	const { layout } = shaderNode;
	if ( layout ) {

		const convert = ( value, type ) => value === undefined ? value : TSL.convert( value, type );
		inputs = isObjectInput( inputs ) ?
			[ Object.fromEntries( layout.inputs.map( ( { name, type } ) => [ name, convert( inputs[ 0 ][ name ], type ) ] ) ) ] :
			layout.inputs.slice( 0, inputs.length ).map( ( { type }, i ) => convert( inputs[ i ], type ) );

	}

	// the statements of the body are added to the stack. With its layout the function would only return a call
	const previousStack = TSL.getCurrentStack();
	const bodyStack = TSL.stack();
	let result;
	TSL.setCurrentStack( bodyStack );
	try {

		result = Object.create( shaderNode, { layout: { value: null } } ).call( inputs ).call( _builder );

	} finally {

		TSL.setCurrentStack( previousStack );

	}

	if ( ! result || ! result.isNode ) unsupported( 'function result' );
	return { result, isExpression: bodyStack.nodes.every( node => node.isVarNode || node.assignable ) };

}

function getCallInputs( shaderNode, rawInputs ) {

	// missing inputs are completed with the layout's defaults, resolved by the node builder
	let inputs = null;
	try {

		inputs = NodeBuilder.prototype._getLayoutInputs.call( Object.create( NodeBuilder.prototype ), shaderNode, rawInputs );

	} catch {

		// handled below

	}

	if ( inputs === null ) {

		unsupported( 'layout function defaults' );

	}

	const { layout } = shaderNode;
	return isObjectInput( inputs ) ? layout.inputs.map( ( { name } ) => inputs[ 0 ][ name ] ) : inputs;

}

/**
 * Compiles node material TSL graphs into lists of instructions. TSL functions are expanded into ops, with those in
 * "WHOLE_FUNCTIONS", those the ops can't express and nodes without ops becoming generated WGSL functions in
 * "functions", which holds only the functions the graphs compiled since the last "resetFunctions" call.
 */
export class MaterialGraphCompiler {

	constructor() {

		this.functions = [];
		this.functionsMap = new Map();
		this.wholeFunctions = null;

		// the uv transform uniforms of the texture nodes
		this.textureTransforms = new WeakMap();

	}

	// clears the generated functions, before compiling the graphs of every material again
	resetFunctions() {

		this.functions = [];
		this.functionsMap = new Map();

	}

	// returns the shader nodes of the functions called as a whole, found by calling them with their default arguments
	getWholeFunctions() {

		if ( this.wholeFunctions === null ) {

			const wholeFunctions = new Set();
			for ( const name of WHOLE_FUNCTIONS ) {

				const value = TSL[ name ];
				if ( value.shaderNode ) {

					wholeFunctions.add( value.shaderNode );

				} else {

					collectLayoutFunctions( value(), wholeFunctions );

				}

			}

			this.wholeFunctions = wholeFunctions;

		}

		return this.wholeFunctions;

	}

	// returns the index of the generated function calling a TSL function with a layout
	getLayoutFunction( shaderNode ) {

		const { functions, functionsMap } = this;
		if ( ! functionsMap.has( shaderNode ) ) {

			const { layout } = shaderNode;
			if ( layout.inputs.length > MAX_CALL_ARGUMENTS ) {

				unsupported( 'function argument count' );

			}

			functionsMap.set( shaderNode, functions.length );
			functions.push( {
				argTypes: layout.inputs.map( input => input.type ),
				length: getLength( layout.type ),
				build: args => shaderNode.call( args ),
			} );

		}

		return functionsMap.get( shaderNode );

	}

	// returns the rows of the texture's uv transform as uniforms so it can change without rebuilding, or null without
	// one
	getTextureTransform( node ) {

		const { value } = node;
		if ( value.matrixAutoUpdate ) {

			value.updateMatrix();

		}

		const { textureTransforms } = this;
		const { elements } = value.matrix;
		if ( ! textureTransforms.has( node ) ) {

			if ( value.matrix.equals( _identity ) ) {

				return null;

			}

			textureTransforms.set( node, [ TSL.uniform( new Vector3() ), TSL.uniform( new Vector3() ) ] );

		}

		const transform = textureTransforms.get( node );
		transform.forEach( ( row, i ) => row.value.set( elements[ i ], elements[ i + 3 ], elements[ i + 6 ] ) );
		return transform;

	}

	// returns the index of the generated function evaluating a node without ops
	getNodeFunction( node, type ) {

		const { functions, functionsMap } = this;
		if ( ! functionsMap.has( node ) ) {

			functionsMap.set( node, functions.length );
			functions.push( {
				argTypes: [],
				length: getLength( type ),
				build: () => node,
			} );

		}

		return functionsMap.get( node );

	}

	/**
	 * Returns whether the material is a node material with a TSL graph for a surface input the path tracer reads.
	 *
	 * @param {NodeMaterial} material
	 * @returns {boolean}
	 */
	hasGraph( material ) {

		return Boolean( material.isNodeMaterial ) && OUTPUTS.some( ( [ , , key ] ) => material[ key ] );

	}

	/**
	 * Compiles the material's graphs into a program writing all outputs, one writing only the opacity for ray
	 * traversal, or null if the opacity isn't tested there, and one writing only the emission for light sampling, or
	 * null without an emission graph. Programs are lists of { op, dst, args, imm, constant,
	 * immediate }: the index of the value written and of those read, each written once, the lanes of a constant, and
	 * the index of the argument that's read from imm as a float instead, or -1.
	 * "getTextureDescriptor" returns the descriptor to sample a texture node with and "getParameterIndex" the index of
	 * a uniform node's first vec4. "object" is one drawn with the material, which custom nodes may read in their setup.
	 *
	 * @param {NodeMaterial} material
	 * @param {function(Node):number} getTextureDescriptor
	 * @param {function(Node):number} getParameterIndex
	 * @param {Object3D|null} [object]
	 * @returns {{ program: Array<Object>, opacityProgram: Array<Object>|null, emissionProgram: Array<Object>|null }}
	 */
	compile( material, getTextureDescriptor, getParameterIndex, object = null ) {

		const build = outputs => new ProgramBuilder( this, getTextureDescriptor, getParameterIndex, material, object ).build( outputs );

		// normals are world space, with the "transformNormalToView" three's MaterialXLoader wraps them in read as is.
		// The alpha test is only an output of the opacity program
		const outputs = OUTPUTS.filter( ( [ name, , key ] ) => material[ key ] && name !== 'alphaTest' );
		const program = build( outputs );

		// the opacity is only tested during traversal for transparent and alpha tested materials
		const opacityOutputs = OUTPUTS.filter( ( [ name, , key ] ) => material[ key ] && /^(opacity|alphaTest)$/.test( name ) );
		const testsOpacity = material.transparent || material.alphaTest > 0 || Boolean( material.alphaTestNode );
		const opacityProgram = testsOpacity && opacityOutputs.length > 0 ? build( opacityOutputs ) : null;

		const emissionOutputs = OUTPUTS.filter( ( [ name, , key ] ) => material[ key ] && name === 'emission' );
		const emissionProgram = emissionOutputs.length > 0 ? build( emissionOutputs ) : null;

		return { program, opacityProgram, emissionProgram };

	}

}

// builds one program
class ProgramBuilder {

	constructor( compiler, getTextureDescriptor, getParameterIndex, material, object ) {

		this.compiler = compiler;
		this.getTextureDescriptor = getTextureDescriptor;
		this.getParameterIndex = getParameterIndex;
		this.material = material;
		this.object = object;
		this.instructions = [];
		this.types = new Map();
		this.expansions = new Map();

		// the nodes custom nodes resolve to in their setup, or null if their setup needs more than the stand in builder
		this.setupResults = new Map();

		// whether a function's body is being compiled, which is called instead if it has anything unsupported
		this.inFunction = false;

		// the values compiled at the hit, and one texture coordinate step along u and v from it
		this.offset = 0;
		this.offsetValues = [ new Map(), new Map(), new Map() ];
		this.registerCount = 0;

		// the register each instruction writes, by its contents
		this.instructionRegisters = new Map();

	}

	get values() {

		return this.offsetValues[ this.offset ];

	}

	build( outputs ) {

		const { material } = this;
		for ( const output of outputs ) {

			const [ , fieldType, key ] = output;
			const node = material[ key ];

			// fall back to a generated function for the whole output if the graph can't be read
			let value;
			try {

				value = this.convert( this.compile( node ), fieldType );

			} catch ( error ) {

				if ( ! ( error instanceof UnsupportedError ) ) throw error;
				console.warn( `MaterialGraphCompiler: Generating "${ key }" of "${ material.name }" as a function, unsupported ${ error.message }.` );
				value = this.emit( OP.CALL, fieldType, [], this.compiler.getNodeFunction( node, fieldType ) );

			}

			this.emit( OP.OUTPUT, null, [ value ], OUTPUTS.indexOf( output ) );

		}

		this.instructions.push( { op: OP.END, dst: null, args: [], imm: 0 } );
		return this.instructions;

	}

	// adds an instruction, or reuses the one that's the same, returning its value
	emit( op, type, args, imm = 0, constant = null ) {

		// a constant with equal lanes is passed to a component wise op in the instruction itself
		let immediate = - 1;
		if ( op >= OP.ABS && op <= OP.COMBINE ) {

			immediate = args.findIndex( arg => arg.constant && arg.constant.slice( 0, getLength( arg.type ) ).every( lane => lane === arg.constant[ 0 ] ) );
			if ( immediate !== - 1 ) {

				imm = new Int32Array( new Float32Array( [ args[ immediate ].constant[ 0 ] ] ).buffer )[ 0 ];

			}

		}

		const registers = args.map( arg => arg.register );
		if ( type === null ) {

			this.instructions.push( { op, dst: null, args: registers, imm, constant, immediate } );
			return null;

		}

		const { instructionRegisters } = this;
		const lanes = constant === null ? [] : new Int32Array( new Float32Array( constant ).buffer );
		const key = [ op, imm, immediate, ...registers.filter( ( register, k ) => k !== immediate ), ...lanes ].join();
		if ( ! instructionRegisters.has( key ) ) {

			const dst = this.registerCount ++;
			this.instructions.push( { op, dst, args: registers, imm, constant, immediate } );
			instructionRegisters.set( key, dst );

		}

		return { register: instructionRegisters.get( key ), type, constant };

	}

	constant( lanes, type ) {

		return this.emit( OP.CONST, type, [], 0, lanes );

	}

	swizzle( value, lanes, type ) {

		if ( value.constant ) {

			return this.constant( lanes.map( lane => value.constant[ lane ] ), type );

		}

		const imm = lanes.reduce( ( imm, lane, i ) => imm | ( lane << ( 2 * i ) ), 0 );
		return this.emit( OP.SWIZZLE, type, [ value ], imm );

	}

	// converts a value to a type with TSL's rules: vectors are truncated, scalars splat and vec2 and vec3 are
	// padded with zero and one, as in "NodeBuilder.format"
	convert( value, type ) {

		const from = value.type;
		const fromLength = getLength( from );
		const toLength = getLength( type );
		const toComponent = getComponentType( type );
		if ( from === type ) return value;

		let result = value;
		if ( fromLength > toLength ) {

			result = toComponent === 'bool' && toLength === 1
				? this.emit( OP.ALL, 'bool', [ value ], fromLength )
				: { register: value.register, type: getType( toLength, getComponentType( from ) ), constant: value.constant };

		} else if ( fromLength === 1 && toLength > 1 ) {

			result = this.swizzle( value, [ 0, 0, 0, 0 ], getType( toLength, getComponentType( from ) ) );

		} else if ( fromLength < toLength ) {

			const padding = toLength === 4 ? [ 0, 0, 0, 1 ] : [ 0, 0, 0, 0 ];
			const base = this.constant( padding, type );
			result = this.emit( OP.INSERT, getType( toLength, getComponentType( from ) ), [ base, value ], fromLength << 2 );

		}

		// cast the components
		const fromComponent = getComponentType( result.type );
		if ( fromComponent !== toComponent ) {

			if ( toComponent === 'bool' ) {

				result = this.emit( OP.TO_BOOL, type, [ result ] );

			} else if ( ( toComponent === 'int' || toComponent === 'uint' ) && fromComponent === 'float' ) {

				result = this.emit( OP.TRUNC, type, [ result ] );

			}

		}

		return { register: result.register, type, constant: result.constant };

	}

	// returns the TSL type of a node
	typeOf( node ) {

		// cached, including failures, since a node's type is read by each of its parents
		const { types } = this;
		if ( ! types.has( node ) ) {

			try {

				types.set( node, this.getNodeType( node ) );

			} catch ( error ) {

				types.set( node, error );

			}

		}

		const type = types.get( node );
		if ( type instanceof Error ) {

			throw type;

		}

		return type;

	}

	getNodeType( node ) {

		if ( VIEW_ACCESSORS.has( node ) ) {

			return 'vec3';

		} else if ( node.isOperatorNode && node.op === '*' && MATRICES.has( node.aNode ) ) {

			return MATRICES.get( node.aNode )[ 1 ] === 'mat3' ? 'vec3' : 'vec4';

		} else if ( ACCESSORS.has( node ) ) {

			return INPUT_TYPES[ ACCESSORS.get( node ) ];

		} else if ( node.isConstNode || ( node.isUniformNode && ! node.isTextureNode ) ) {

			return node.nodeType || getValueType( node.value );

		} else if ( isType( node, 'ConvertNode' ) ) {

			const types = node.convertTo.split( '|' );
			const length = getLength( this.typeOf( node.node ) );
			return types.find( type => getLength( type ) === length ) ?? types[ 0 ];

		} else if ( isType( node, 'JoinNode' ) ) {

			return node.nodeType || getType( node.nodes.reduce( ( sum, n ) => sum + getLength( this.typeOf( n ) ), 0 ), 'float' );

		} else if ( node.isSplitNode ) {

			return getType( node.components.length, getComponentType( this.typeOf( node.node ) ) );

		} else if ( node.isArrayElementNode ) {

			return getComponentType( this.typeOf( node.node ) );

		} else if ( this.getMatrixProduct( node ) ) {

			return `vec${ this.getMatrixProduct( node ).size }`;

		} else if ( node.isOperatorNode ) {

			const { op } = node;
			const typeA = this.typeOf( node.aNode );
			const typeB = node.bNode ? this.typeOf( node.bNode ) : null;
			if ( op === '&&' || op === '||' || op === '^^' ) return 'bool';
			if ( op === '!' ) return getType( getLength( typeA ), 'bool' );
			if ( COMPARISONS.has( op ) ) {

				return getType( Math.max( getLength( typeA ), getLength( typeB ) ), 'bool' );

			}

			if ( typeB === null ) return typeA;
			const type = getLength( typeB ) > getLength( typeA ) ? typeB : typeA;
			return getType( getLength( type ), this.promote( [ node.aNode, node.bNode ] ) );

		} else if ( node.isMathNode ) {

			const { method } = node;
			if ( method === 'length' || method === 'distance' || method === 'dot' ) return 'float';
			if ( method === 'cross' ) return 'vec3';
			if ( method === 'all' || method === 'any' ) return 'bool';
			return this.getMathInputType( node );

		} else if ( isType( node, 'ConditionalNode' ) ) {

			const typeA = this.typeOf( node.ifNode );
			const typeB = this.typeOf( node.elseNode );
			return getLength( typeB ) > getLength( typeA ) ? typeB : typeA;

		} else if ( node.isVarNode || node.isVaryingNode || node.isContextNode || node.isSubBuildNode ) {

			return this.typeOf( node.node );

		} else if ( node.isTextureNode ) {

			return 'vec4';

		} else if ( isType( node, 'NormalMapNode' ) || node.isHeightToNormalNode ) {

			return 'vec3';

		} else if ( isType( node, 'AttributeNode' ) && node._attributeName in ATTRIBUTES ) {

			return ATTRIBUTES[ node._attributeName ][ 1 ];

		} else if ( node.isShaderCallNodeInternal ) {

			const { shaderNode } = node;
			if ( shaderNode === transformNormalToView.shaderNode ) return 'vec3';
			return getFunctionType( shaderNode ) ?? this.typeOf( this.expand( node, shaderNode, node.rawInputs ?? [] ).result );

		} else if ( node.functionNodes ) {

			return this.getOverload( node ).shaderNode.layout.type;

		} else if ( this.resolveSetup( node ) ) {

			return this.typeOf( this.resolveSetup( node ) );

		}

		return unsupported( `node "${ node.constructor.type }"` );

	}

	// returns the node a node without ops resolves to in its setup, as custom nodes do, or null if its setup needs more
	// than the object, material, geometry and context of the stand in builder
	resolveSetup( node ) {

		const { setupResults, object, material } = this;
		if ( ! setupResults.has( node ) ) {

			const builder = new Proxy( { object, material, geometry: object?.geometry ?? null, context: {} }, {
				get: ( target, key ) => {

					if ( ! ( key in target ) ) throw new UnsupportedError( `builder "${ String( key ) }"` );
					return target[ key ];

				},
			} );

			let result = null;
			try {

				result = node.setup( builder );

			} catch {

				// a setup needing more of the builder is run by three.js in a generated function instead

			}

			setupResults.set( node, result && result.isNode && result !== node ? result : null );

		}

		return setupResults.get( node );

	}

	// the component type of an operation's result, ignoring weak constants as in TSL
	promote( nodes ) {

		const types = nodes.filter( node => node && ! isWeak( node ) ).map( node => getComponentType( this.typeOf( node ) ) );
		if ( types.length === 0 || types.includes( 'float' ) ) return 'float';
		if ( types.includes( 'int' ) ) return 'int';
		if ( types.includes( 'uint' ) ) return 'uint';
		return 'bool';

	}

	// the type a math node's inputs are converted to: the longest input, as in "MathNode.getInputType"
	getMathInputType( node ) {

		const nodes = [ node.aNode, node.bNode, node.cNode ];
		const types = nodes.map( n => n ? this.typeOf( n ) : null );
		const lengths = types.map( t => t ? getLength( t ) : 0 );
		let type;
		if ( lengths[ 0 ] > lengths[ 1 ] && lengths[ 0 ] > lengths[ 2 ] ) type = types[ 0 ];
		else if ( lengths[ 1 ] > lengths[ 2 ] ) type = types[ 1 ];
		else if ( lengths[ 2 ] > lengths[ 0 ] ) type = types[ 2 ];
		else type = types[ 0 ];

		const component = /^(sin|cos|tan|asin|acos|atan|exp|log|sqrt|pow|radians|degrees|fract|normalize|length|distance|smoothstep|mix|reflect|refract)/.test( node.method ) ? 'float' : this.promote( nodes );
		return getType( getLength( type ), component );

	}

	// the overload of a "FunctionOverloadingNode" matching the argument types, as in "getCandidateFn"
	getOverload( node ) {

		let best = null;
		let bestScore = - 1;
		const types = node.parametersNodes.map( param => getType( getLength( this.typeOf( param ) ), getComponentType( this.typeOf( param ) ) ) );
		for ( const fn of node.functionNodes ) {

			const { inputs } = fn.shaderNode.layout;
			if ( inputs.length !== types.length ) continue;

			const score = inputs.filter( ( input, i ) => input.type === types[ i ] ).length;
			if ( score > bestScore ) {

				best = fn;
				bestScore = score;

			}

		}

		return best ?? unsupported( 'function overload' );

	}

	// returns the value "callback" compiles, or the one "fallback" does if it finds anything unsupported
	attempt( callback, fallback ) {

		const { instructions, instructionRegisters, registerCount, offset, inFunction } = this;
		const instructionCount = instructions.length;
		try {

			return callback();

		} catch ( error ) {

			if ( ! ( error instanceof UnsupportedError ) ) throw error;

			// drop the partial program, and the values compiled for it
			instructions.length = instructionCount;
			this.offsetValues.forEach( map => map.forEach( ( { register }, key ) => register >= registerCount && map.delete( key ) ) );
			instructionRegisters.forEach( ( register, key ) => register >= registerCount && instructionRegisters.delete( key ) );
			this.offset = offset;
			this.inFunction = inFunction;
			return fallback( error );

		}

	}

	// compiles a node, generating a function for it if the interpreter can't run it
	compile( node ) {

		const { values } = this;
		if ( values.has( node ) ) return values.get( node );

		const value = this.attempt( () => this.compileNode( node ), error => {

			if ( this.inFunction ) throw error;

			const type = this.typeOf( node );
			return this.emit( OP.CALL, type, [], this.compiler.getNodeFunction( node, type ) );

		} );

		values.set( node, value );
		return value;

	}

	compileNode( node ) {

		if ( VIEW_ACCESSORS.has( node ) ) {

			const [ worldNode, w ] = VIEW_ACCESSORS.get( node );
			return this.toView( this.compile( worldNode ), w );

		} else if ( node.isOperatorNode && node.op === '*' && MATRICES.has( node.aNode ) ) {

			// a matrix times a vector, applying the matrix's transforms in order
			const [ ops, type ] = MATRICES.get( node.aNode );
			let value = this.homogeneous( this.compile( node.bNode ), type === 'mat3' ? 0 : 1 );
			for ( const op of ops ) {

				value = this.emit( OP[ op ], 'vec4', [ value ] );

			}

			return type === 'mat3' ? this.convert( value, 'vec3' ) : value;

		} else if ( ACCESSORS.has( node ) ) {

			const input = ACCESSORS.get( node );
			const stepped = input === 'positionLocal' || input === 'positionWorld' ? this.offset << 8 : 0;
			return this.emit( OP.INPUT, INPUT_TYPES[ input ], [], INPUTS.indexOf( input ) | stepped );

		} else if ( node.isConstNode ) {

			return this.constant( getValueLanes( node.value ), this.typeOf( node ) );

		} else if ( node.isUniformNode && ! node.isTextureNode ) {

			// uniforms are read from the parameters texture so their values can change
			return this.emit( OP.PARAM, this.typeOf( node ), [], this.getParameterIndex( node ) );

		} else if ( isType( node, 'ConvertNode' ) ) {

			return this.convert( this.compile( node.node ), this.typeOf( node ) );

		} else if ( node.isVarNode || node.isVaryingNode || node.isContextNode || node.isSubBuildNode ) {

			return this.compile( node.node );

		} else if ( isType( node, 'AttributeNode' ) ) {

			const [ input, type ] = ATTRIBUTES[ node._attributeName ] ?? unsupported( `attribute "${ node._attributeName }"` );
			const stepped = /^(uv|uv1|positionLocal)$/.test( input ) ? this.offset << 8 : 0;
			return this.emit( OP.INPUT, type, [], INPUTS.indexOf( input ) | stepped );

		} else if ( isType( node, 'JoinNode' ) ) {

			return this.join( node.nodes.map( part => this.compile( part ) ), this.typeOf( node ) );

		} else if ( node.isSplitNode ) {

			const lanes = [ ...node.components ].map( c => LANES[ c ] );
			while ( lanes.length < 4 ) lanes.push( 0 );
			return this.swizzle( this.compile( node.node ), lanes, this.typeOf( node ) );

		} else if ( node.isArrayElementNode ) {

			const index = node.indexNode;
			getLength( this.typeOf( node.node ) );
			if ( ! index.isConstNode ) {

				return this.emit( OP.ELEMENT, this.typeOf( node ), [ this.compile( node.node ), this.compile( index ) ] );

			}

			return this.swizzle( this.compile( node.node ), [ index.value, 0, 0, 0 ], this.typeOf( node ) );

		} else if ( this.getMatrixProduct( node ) ) {

			return this.compileMatrixProduct( this.getMatrixProduct( node ) );

		} else if ( node.isOperatorNode ) {

			return this.compileOperator( node );

		} else if ( node.isMathNode ) {

			return this.compileMath( node );

		} else if ( isType( node, 'ConditionalNode' ) ) {

			if ( ! node.elseNode ) unsupported( 'conditional without else' );
			const type = this.typeOf( node );
			const condition = this.convert( this.compile( node.condNode ), getType( getLength( type ), 'bool' ) );
			const a = this.convert( this.compile( node.ifNode ), type );
			const b = this.convert( this.compile( node.elseNode ), type );
			return this.emit( OP.SELECT, type, [ condition, a, b ] );

		} else if ( node.isTextureNode ) {

			return this.compileTexture( node );

		} else if ( isType( node, 'NormalMapNode' ) ) {

			return this.compileNormalMap( node );

		} else if ( node.isHeightToNormalNode ) {

			return this.compileHeightToNormal( node );

		} else if ( node.isShaderCallNodeInternal ) {

			// three's MaterialXLoader wraps its world space normals in this, which takes object space ones
			if ( node.shaderNode === transformNormalToView.shaderNode ) {

				return this.toView( this.compile( node.rawInputs[ 0 ] ), 0 );

			}

			return this.compileFunction( node, node.shaderNode, node.rawInputs ?? [] );

		} else if ( node.functionNodes ) {

			return this.compileFunction( node, this.getOverload( node ).shaderNode, node.parametersNodes );

		} else if ( this.resolveSetup( node ) ) {

			return this.compile( this.resolveSetup( node ) );

		}

		return unsupported( `node "${ node.constructor.type }"` );

	}

	// returns the values joined into a vector of the type
	join( parts, type ) {

		const isFloats = parts.every( value => getLength( value.type ) === 1 );
		if ( isFloats && parts.length === getLength( type ) && ( parts.length === 2 || parts.length === 3 ) ) {

			return this.emit( OP.COMBINE, type, parts );

		}

		let result = this.constant( [ 0, 0, 0, 0 ], type );
		let offset = 0;
		for ( const value of parts ) {

			const length = getLength( value.type );
			result = this.emit( OP.INSERT, type, [ result, value ], offset | ( length << 2 ) );
			offset += length;

		}

		return result;

	}

	// returns the matrix and vector multiplied, the vector as a row if it comes first, and the matrix's size, or null
	// if the node isn't such a product
	getMatrixProduct( node ) {

		if ( ! node.isOperatorNode || node.op !== '*' || ! node.bNode ) return null;

		const typeA = this.typeOf( node.aNode );
		const typeB = this.typeOf( node.bNode );
		const isMatrixA = /^mat[34]$/.test( typeA );
		const isMatrixB = /^mat[34]$/.test( typeB );
		if ( isMatrixA && isMatrixB ) unsupported( 'matrix product' );
		if ( isMatrixA ) return { matrix: node.aNode, vector: node.bNode, size: Number( typeA[ 3 ] ), isRow: false };
		if ( isMatrixB ) return { matrix: node.bNode, vector: node.aNode, size: Number( typeB[ 3 ] ), isRow: true };
		return null;

	}

	compileMatrixProduct( { matrix, vector, size, isRow } ) {

		const type = `vec${ size }`;
		const v = this.convert( this.compile( vector ), type );

		// uniforms are read a column per parameter
		let columns;
		if ( matrix.isUniformNode ) {

			const index = this.getParameterIndex( matrix );
			columns = Array.from( { length: size }, ( _, i ) => this.emit( OP.PARAM, type, [], index + i ) );

		} else if ( matrix.isConstNode ) {

			const lanes = getValueLanes( matrix.value );
			columns = Array.from( { length: size }, ( _, i ) => this.constant( lanes.slice( i * 4, i * 4 + 4 ), type ) );

		} else {

			unsupported( 'matrix' );

		}

		if ( isRow ) {

			return this.join( columns.map( column => this.emit( OP.DOT, 'float', [ v, column ], size ) ), type );

		}

		// the columns weighted by the vector's components
		return columns
			.map( ( column, i ) => this.emit( OP.MUL, type, [ column, this.swizzle( v, [ i, i, i, i ], type ) ] ) )
			.reduce( ( sum, term ) => this.emit( OP.ADD, type, [ sum, term ] ) );

	}

	compileOperator( node ) {

		const { op, aNode, bNode } = node;
		const type = this.typeOf( node );
		if ( op === '!' ) {

			return this.emit( OP.NOT, type, [ this.compile( aNode ) ] );

		}

		if ( ! ( op in OPERATORS ) || ! bNode ) unsupported( `operator "${ op }"` );

		// operands are converted to the longer type, so comparisons are made on vectors
		const isComparison = COMPARISONS.has( op );
		const isLogical = op === '&&' || op === '||' || op === '^^';
		const typeA = this.typeOf( aNode );
		const typeB = this.typeOf( bNode );
		const length = Math.max( getLength( typeA ), getLength( typeB ) );
		const operandType = isLogical ? 'bool' : getType( length, this.promote( [ aNode, bNode ] ) );
		const component = getComponentType( operandType );
		const isInteger = component === 'int' || component === 'uint';

		// uints wrap, as hashes rely on, which the floats they're stored as don't
		if ( component === 'uint' && ! isComparison ) unsupported( 'uint arithmetic' );

		const a = this.convert( this.compile( aNode ), operandType );
		const b = this.convert( this.compile( bNode ), operandType );
		if ( op === '%' && isInteger ) {

			return this.emit( OP.MOD_TRUNC, type, [ a, b ] );

		}

		const result = this.emit( OP[ OPERATORS[ op ] ], isComparison ? type : operandType, [ a, b ] );
		return op === '/' && isInteger ? this.emit( OP.TRUNC, type, [ result ] ) : result;

	}

	compileMath( node ) {

		const { method, aNode, bNode, cNode } = node;
		const inputType = this.getMathInputType( node );
		const length = getLength( inputType );
		const args = [ aNode, bNode, cNode ].filter( Boolean ).map( n => this.convert( this.compile( n ), inputType ) );

		if ( method in UNARY_METHODS ) return this.emit( OP[ UNARY_METHODS[ method ] ], inputType, args );
		if ( method in BINARY_METHODS ) return this.emit( OP[ BINARY_METHODS[ method ] ], inputType, args );
		if ( method in TERNARY_METHODS ) return this.emit( OP[ TERNARY_METHODS[ method ] ], inputType, args );

		switch ( method ) {

			case 'atan': return this.emit( args.length === 2 ? OP.ATAN2 : OP.ATAN, inputType, args );
			case 'dot': return this.emit( OP.DOT, 'float', args, length );
			case 'length': return this.emit( OP.LENGTH, 'float', args, length );
			case 'distance': return this.emit( OP.DISTANCE, 'float', args, length );
			case 'normalize': return this.emit( OP.NORMALIZE, inputType, args, length );
			case 'all': return this.emit( OP.ALL, 'bool', args, length );
			case 'any': return this.emit( OP.ANY, 'bool', args, length );
			case 'cross': return this.emit( OP.CROSS, 'vec3', args );
			case 'reflect': return this.emit( OP.REFLECT, inputType, args, length );
			case 'refract': return this.emit( OP.REFRACT, inputType, args );

			// there are no derivatives in a compute shader. The filter width is a small value so dividing by it
			// is finite
			case 'dFdx': case 'dFdy': return this.constant( [ 0, 0, 0, 0 ], inputType );
			case 'fwidth': return this.constant( [ 1e-4, 1e-4, 1e-4, 1e-4 ], inputType );

		}

		return unsupported( `math method "${ method }"` );

	}

	compileTexture( node ) {

		// the texture's transform is applied to its own uv only, as in three.js
		let uvNode = node.uvNode ?? TSL.uv( node.value.channel );
		const transform = node.updateMatrix ? this.compiler.getTextureTransform( node ) : null;
		if ( transform !== null ) {

			const uv3 = TSL.vec3( uvNode, 1 );
			uvNode = TSL.vec2( TSL.dot( uv3, transform[ 0 ] ), TSL.dot( uv3, transform[ 1 ] ) );

		}

		const uv = this.convert( this.compile( uvNode ), 'vec2' );
		return this.emit( OP.TEXTURE, 'vec4', [ uv ], this.getTextureDescriptor( node ) );

	}

	// the normal of a height from its slope, found by compiling the height at the hit and again one texture
	// coordinate step along u and v, as MaterialX's "heighttonormal" does with screen space derivatives
	compileHeightToNormal( node ) {

		const offset = this.offset;
		const samples = [ 0, 1, 2 ].map( step => {

			this.offset = step;
			return {
				height: this.convert( this.compile( node.heightNode ), 'float' ),
				texcoord: this.convert( this.compile( node.texcoordNode ), 'vec2' ),
			};

		} );
		this.offset = offset;

		// the scale matches a Sobel filter's
		const scale = this.emit( OP.MUL, 'float', [ this.convert( this.compile( node.scaleNode ), 'float' ), this.constant( [ 1 / 16, 0, 0, 0 ], 'float' ) ] );
		const slopes = [ 1, 2 ].map( step => {

			const texcoordChange = this.emit( OP.SUB, 'vec2', [ samples[ step ].texcoord, samples[ 0 ].texcoord ] );
			const heightChange = this.emit( OP.MUL, 'float', [ this.emit( OP.SUB, 'float', [ samples[ step ].height, samples[ 0 ].height ] ), scale ] );
			const slope = this.emit( OP.INSERT, 'vec3', [ this.constant( [ 0, 0, 0, 0 ], 'vec3' ), texcoordChange ], 2 << 2 );
			return this.emit( OP.INSERT, 'vec3', [ slope, heightChange ], 2 | ( 1 << 2 ) );

		} );

		// mirrored texture coordinates flip the normal
		let normal = this.emit( OP.CROSS, 'vec3', slopes );
		normal = this.emit( OP.MUL, 'vec3', [ normal, this.emit( OP.SIGN, 'vec3', [ this.swizzle( normal, [ 2, 2, 2, 2 ], 'vec3' ) ] ) ] );
		normal = this.emit( OP.NORMALIZE, 'vec3', [ normal ], 3 );

		const half = this.constant( [ 0.5, 0.5, 0.5, 0.5 ], 'vec3' );
		return this.emit( OP.ADD, 'vec3', [ this.emit( OP.MUL, 'vec3', [ normal, half ] ), half ] );

	}

	// a tangent space normal map in the hit's world space tangent frame
	compileNormalMap( node ) {

		if ( node.normalMapType !== TangentSpaceNormalMap ) unsupported( 'object space normal map' );

		const texel = this.convert( this.compile( node.node ), 'vec3' );
		const two = this.constant( [ 2, 2, 2, 2 ], 'vec3' );
		const one = this.constant( [ 1, 1, 1, 1 ], 'vec3' );
		let normal = this.emit( OP.SUB, 'vec3', [ this.emit( OP.MUL, 'vec3', [ texel, two ] ), one ] );
		if ( node.scaleNode ) {

			// scale x and y only
			const scale = this.convert( this.compile( node.scaleNode ), 'vec2' );
			const scale3 = this.emit( OP.INSERT, 'vec3', [ one, scale ], 2 << 2 );
			normal = this.emit( OP.MUL, 'vec3', [ normal, scale3 ] );

		}

		const frame = [ 'tangentWorld', 'bitangentWorld', 'normalWorld' ].map( input => this.emit( OP.INPUT, 'vec3', [], INPUTS.indexOf( input ) ) );
		let result = null;
		frame.forEach( ( axis, i ) => {

			const term = this.emit( OP.MUL, 'vec3', [ axis, this.swizzle( normal, [ i, i, i, i ], 'vec3' ) ] );
			result = result ? this.emit( OP.ADD, 'vec3', [ result, term ] ) : term;

		} );

		// three.js' normal maps are in view space
		return this.toView( this.emit( OP.NORMALIZE, 'vec3', [ result ], 3 ), 0 );

	}

	// "value" as a vec4 to transform as a point, with a "w" of 1, or a direction, with 0
	homogeneous( value, w ) {

		if ( getLength( value.type ) === 4 ) return value;
		const base = this.constant( [ 0, 0, 0, w ], 'vec4' );
		return this.emit( OP.INSERT, 'vec4', [ base, this.convert( value, 'vec3' ) ], 3 << 2 );

	}

	// a world space point ( w = 1 ) or direction ( w = 0 ) in view space
	toView( value, w ) {

		return this.emit( OP.VIEW_MATRIX, 'vec3', [ this.homogeneous( value, w ) ] );

	}

	// returns the evaluated body of the function the node calls
	expand( node, shaderNode, inputs ) {

		const { expansions } = this;
		if ( ! expansions.has( node ) ) {

			expansions.set( node, expandFunction( shaderNode, inputs ) );

		}

		return expansions.get( node );

	}

	// expands a TSL function into ops, or calls it as a generated function if it's kept whole or the ops can't express it
	compileFunction( node, shaderNode, inputs ) {

		if ( this.compiler.getWholeFunctions().has( shaderNode ) ) {

			return this.compileCall( shaderNode, inputs );

		}

		// the inputs aren't part of the function's body, so they're compiled ahead of it
		const values = isObjectInput( inputs ) ? Object.values( inputs[ 0 ] ) : inputs;
		values.forEach( value => value?.isNode && ! value.isTextureNode && this.compile( value ) );

		return this.attempt( () => {

			const { result, isExpression } = this.expand( node, shaderNode, inputs );
			if ( ! isExpression ) unsupported( 'function statements' );

			const { inFunction } = this;
			this.inFunction = true;
			const value = this.compile( result );
			this.inFunction = inFunction;

			const type = getFunctionType( shaderNode );
			return type === null ? value : this.convert( value, type );

		}, error => {

			if ( ! shaderNode.layout ) throw error;
			return this.compileCall( shaderNode, inputs );

		} );

	}

	compileCall( shaderNode, rawInputs ) {

		const { layout } = shaderNode;
		const inputs = getCallInputs( shaderNode, rawInputs );
		const index = this.compiler.getLayoutFunction( shaderNode );
		const args = layout.inputs.map( ( input, i ) => {

			const arg = inputs[ i ];
			if ( arg === undefined || arg === null ) unsupported( 'missing function argument' );
			return this.convert( this.compile( arg.isNode ? arg : TSL.float( arg ) ), input.type );

		} );

		return this.emit( OP.CALL, layout.type, args, index );

	}

}
