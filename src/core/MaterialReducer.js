// https://github.com/gkjohnson/webxr-sandbox/blob/main/skinned-mesh-batching/src/MaterialReducer.js

function isTypedArray( arr ) {

	return arr.buffer instanceof ArrayBuffer && 'BYTES_PER_ELEMENT' in arr;

}

export class MaterialReducer {

	constructor() {

		const ignoreKeys = new Set();
		ignoreKeys.add( 'uuid' );

		this.ignoreKeys = ignoreKeys;
		this.shareTextures = true;
		this.textures = [];
		this.materials = [];

	}

	areEqual( objectA, objectB ) {

		const keySet = new Set();
		const traverseSet = new Set();
		const ignoreKeys = this.ignoreKeys;

		const traverse = ( a, b ) => {

			if ( a === b ) {

				return true;

			}

			if ( a && b && a instanceof Object && b instanceof Object ) {

				if ( traverseSet.has( a ) || traverseSet.has( b ) ) {

					throw new Error( 'MaterialReducer: Material is recursive.' );

				}

				const aIsElement = a instanceof Element;
				const bIsElement = b instanceof Element;
				if ( aIsElement || bIsElement ) {

					if ( aIsElement !== bIsElement || ! ( a instanceof Image ) || ! ( b instanceof Image ) ) {

						return false;

					}

					return a.src === b.src;

				}

				const aIsImageBitmap = a instanceof ImageBitmap;
				const bIsImageBitmap = b instanceof ImageBitmap;
				if ( aIsImageBitmap || bIsImageBitmap ) {

					return false;

				}

				if ( a.equals ) {

					return a.equals( b );

				}

				const aIsTypedArray = isTypedArray( a );
				const bIsTypedArray = isTypedArray( b );
				if ( aIsTypedArray || bIsTypedArray ) {

					if ( aIsTypedArray !== bIsTypedArray || a.constructor !== b.constructor || a.length !== b.length ) {

						return false;

					}

					for ( let i = 0, l = a.length; i < l; i ++ ) {

						if ( a[ i ] !== b[ i ] ) return false;

					}

					return true;

				}

				traverseSet.add( a );
				traverseSet.add( b );

				keySet.clear();
				for ( const key in a ) {

					if ( ! a.hasOwnProperty( key ) || a[ key ] instanceof Function || ignoreKeys.has( key ) ) {

						continue;

					}

					keySet.add( key );

				}

				for ( const key in b ) {

					if ( ! b.hasOwnProperty( key ) || b[ key ] instanceof Function || ignoreKeys.has( key ) ) {

						continue;

					}

					keySet.add( key );

				}

				const keys = Array.from( keySet.values() );
				let result = true;
				for ( const i in keys ) {

					const key = keys[ i ];
					if ( ignoreKeys.has( key ) ) {

						continue;

					}

					result = traverse( a[ key ], b[ key ] );
					if ( ! result ) {

						break;

					}

				}

				traverseSet.delete( a );
				traverseSet.delete( b );
				return result;

			}

			return false;

		};

		return traverse( objectA, objectB );

	}

	process( object ) {

		const { textures, materials } = this;
		let replaced = 0;

		const processMaterial = material => {

			// Check if another material matches this one
			let foundMaterial = null;
			for ( const i in materials ) {

				const otherMaterial = materials[ i ];
				if ( this.areEqual( material, otherMaterial ) ) {

					foundMaterial = otherMaterial;

				}

			}

			if ( foundMaterial ) {

				replaced ++;
				return foundMaterial;

			} else {

				materials.push( material );

				if ( this.shareTextures ) {

					// See if there's another texture that matches the ones on this material
					for ( const key in material ) {

						if ( ! material.hasOwnProperty( key ) ) continue;

						const value = material[ key ];
						if ( value && value.isTexture && value.image instanceof Image ) {

							let foundTexture = null;
							for ( const i in textures ) {

								const texture = textures[ i ];
								if ( this.areEqual( texture, value ) ) {

									foundTexture = texture;
									break;

								}

							}

							if ( foundTexture ) {

								material[ key ] = foundTexture;

							} else {

								textures.push( value );

							}

						}

					}

				}

				return material;

			}

		};

		object.traverse( c => {

			if ( c.isMesh && c.material ) {

				const material = c.material;
				if ( Array.isArray( material ) ) {

					for ( let i = 0; i < material.length; i ++ ) {

						material[ i ] = processMaterial( material[ i ] );

					}

				} else {

					c.material = processMaterial( material );

				}

			}

		} );

		return { replaced, retained: materials.length };

	}

}
