import { FunctionNode, Node } from 'three/webgpu';

// minimal node that outputs a raw WGSL expression verbatim when built,
// bypassing TSL's temp variable wrapping and type formatting
class RawExpression extends Node {

	constructor( code ) {

		super();
		this.code = code;

	}

	build() {

		return this.code;

	}

}

// wraps a FunctionNode so that build() returns just the function name
class PropertyRefNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.build( builder, 'property' );

	}

}

// wraps a FunctionCallNode so that build() returns the inline call expression,
// bypassing TempNode's variable wrapping
class InlineCallNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.generate( builder );

	}

}

// returns the node that should be registered as an include for the given arg,
// or null if the arg doesn't represent a dependency (e.g. a string, number, or plain node)
function getIncludeNode( arg ) {

	if ( typeof arg === 'function' ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStruct ) return arg.layout;
		return null;

	}

	if ( arg && arg.isNode ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStructLayoutNode || arg.isCodeNode ) return arg;

	}

	return null;

}

export class WGSLTagFnNode extends FunctionNode {

	static get type() {

		return 'WGSLFnTagNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		// extract dependencies for includes from the original args — function definitions,
		// struct types, and code nodes need to be pre-registered so their code appears before ours.
		// callable wrappers and FunctionCallNodes are unwrapped to the underlying FunctionNode;
		// plain nodes (uniforms, storage, etc) are built inline in generate() and don't need includes.
		// arrays are treated as explicit include lists — each element is registered as a dependency.
		const includes = [];

		for ( const arg of args ) {

			if ( Array.isArray( arg ) ) {

				for ( const element of arg ) {

					// unwrap callable wrappers; accept any remaining node directly
					// (storage, uniforms, etc. need to be built to register bindings)
					const node = getIncludeNode( element );
					if ( node ) includes.push( node );
					else if ( element && element.isNode ) includes.push( element );

				}

			} else {

				const node = getIncludeNode( arg );
				if ( node ) includes.push( node );

			}

		}

		// normalize args so generate() can resolve them uniformly with build():
		// - callable wrappers → PropertyRefNode (emits just the function name)
		// - struct callables → StructTypeNode (emits the type name via build)
		// - FunctionCallNodes → InlineCallNode (emits inline call, bypassing TempNode)
		const normalizedArgs = args.map( arg => {

			if ( typeof arg === 'function' && arg.functionNode ) return new PropertyRefNode( arg.functionNode );
			if ( typeof arg === 'function' && arg.isStruct ) return arg.layout;
			if ( arg && arg.isNode && arg.functionNode ) return new InlineCallNode( arg );
			return arg;

		} );

		super( '', includes, lang );

		this.tokens = tokens;
		this.args = normalizedArgs;

	}

	// assemble the signature from tokens and arg names (struct types may appear
	// in the signature as return types or parameter types), then parse it
	getNodeFunction( builder ) {

		const { tokens, args } = this;
		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			// reconstruct the full code with known names for struct args
			// and dummy identifiers for everything else
			let fullCode = '';
			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				fullCode += tokens[ i ];

				if ( i < args.length ) {

					const arg = args[ i ];
					if ( Array.isArray( arg ) ) {

						// include array — no text output

					} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

						fullCode += String( arg );

					} else if ( arg.isStructLayoutNode ) {

						fullCode += arg.getNodeType( builder );

					} else {

						fullCode += '_arg' + i;

					}

				}

			}

			const braceIndex = fullCode.indexOf( '{' );
			let sig = braceIndex !== - 1 ? fullCode.substring( 0, braceIndex ) : fullCode;
			sig = sig.replace( /\/\/.+[\n\r]/g, '' );

			nodeFunction = builder.parser.parseFunction( sig + ' {}' );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	generate( builder, output ) {

		const { tokens, args } = this;

		// let FunctionNode.generate handle includes, code registration, property naming,
		// and type normalization (e.g. stripping "-> void" which is not valid WGSL)
		const result = super.generate( builder, output );

		// assemble the body by interleaving static tokens with resolved node names
		const parts = [];

		for ( let i = 0, l = tokens.length; i < l; i ++ ) {

			parts.push( tokens[ i ] );

			if ( i < args.length ) {

				const arg = args[ i ];
				if ( Array.isArray( arg ) ) {

					// include array — no text output

				} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

					parts.push( String( arg ) );

				} else {

					parts.push( arg.build( builder ) );

				}

			}

		}

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		// use the declaration from super (handles type normalization and name assignment),
		// replace its empty body with the assembled body from the template
		const declaration = nodeCode.code;
		const declPrefix = declaration.substring( 0, declaration.indexOf( '{' ) + 1 );

		const assembledCode = parts.join( '' );
		const bodyStart = assembledCode.indexOf( '{' ) + 1;
		const bodyEnd = assembledCode.lastIndexOf( '}' );
		const body = assembledCode.substring( bodyStart, bodyEnd );

		nodeCode.code = declPrefix + body + '}\n';

		return result;

	}

}

export const wgslTagFn = ( tokens, ...args ) => {

	const functionNode = new WGSLTagFnNode( tokens, args );

	const fn = ( ...params ) => {

		// wrap string parameter values as raw WGSL expressions
		// so they output verbatim as identifiers (e.g. local variable names)
		if ( params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode ) {

			const obj = params[ 0 ];
			for ( const key in obj ) {

				if ( typeof obj[ key ] === 'string' ) {

					obj[ key ] = new RawExpression( obj[ key ] );

				}

			}

		}

		return functionNode.call( ...params );

	};

	fn.functionNode = functionNode;

	return fn;

};
