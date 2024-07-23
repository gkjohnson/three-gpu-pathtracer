import * as THREE from 'three';

export class AlbedoNormalPass {

	get useWorldSpaceNormals() {

		return this._useWorldSpaceNormals;

	}

	set useWorldSpaceNormals( value ) {

		this.setUseWorldSpaceNormals( value );

	}

	constructor( useWorldSpaceNormals = true ) {

		this.originalMaterials = new Map();
		this.albedoMaterials = new Map();
		this._useWorldSpaceNormals = useWorldSpaceNormals;

		// RT
		this.renderTarget = new THREE.WebGLRenderTarget( 1, 1, {
			samples: 4,
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			count: 2
		} );
		this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

		this.albedoNormalMaterial = new THREE.ShaderMaterial( {
			uniforms: {
				diffuseMap: { value: null },
				normalMap: { value: null },
				color: { value: new THREE.Color( 1, 1, 1 ) },
				useWorldSpaceNormals: { value: this._useWorldSpaceNormals }
			},
			vertexShader: `
                varying vec2 vUv;
                varying vec3 vViewPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                #ifdef USE_TANGENT
                    varying vec3 vTangent;
                    varying vec3 vBitangent;
                #endif

                void main() {
                    vUv = uv;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    vViewPosition = -mvPosition.xyz;
                    vNormal = normalMatrix * normal;
                    vWorldNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
                    #ifdef USE_TANGENT
                        vTangent = normalMatrix * tangent.xyz;
                        vBitangent = cross(vNormal, vTangent) * tangent.w;
                    #endif
                }
            `,
			fragmentShader: `
                uniform vec3 color;
                uniform sampler2D diffuseMap;
                uniform sampler2D normalMap;
                uniform bool useWorldSpaceNormals;

                varying vec2 vUv;
                varying vec3 vViewPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                #ifdef USE_TANGENT
                    varying vec3 vTangent;
                    varying vec3 vBitangent;
                #endif

                layout(location = 0) out vec4 gAlbedo;
                layout(location = 1) out vec4 gNormal;

                void main() {
                    // Albedo
                    vec4 diffuseColor = texture(diffuseMap, vUv);
                    vec3 albedo = diffuseColor.rgb * color;
                    gAlbedo = vec4(albedo, diffuseColor.a);

                    // Normal
                    vec3 normal;
                    #ifdef USE_TANGENT
                        vec3 mapN = texture(normalMap, vUv).xyz * 2.0 - 1.0;
                        mat3 tbn = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
                        normal = normalize(tbn * mapN);
                    #else
                        normal = normalize(vNormal);
                    #endif

                    if (useWorldSpaceNormals) {
                        #ifdef USE_TANGENT
                            // Transform the normal from tangent space to world space
                            vec3 worldTangent = normalize((modelMatrix * vec4(tangent.xyz, 0.0)).xyz);
                            vec3 worldBitangent = normalize(cross(vWorldNormal, worldTangent) * tangent.w);
                            mat3 worldTBN = mat3(worldTangent, worldBitangent, vWorldNormal);
                            normal = normalize(worldTBN * mapN);
                        #else
                            normal = normalize(vWorldNormal);
                        #endif
                    }

                    gNormal = vec4(normal * 0.5 + 0.5, 1.0);
                }
            `,
			glslVersion: THREE.GLSL3
		} );

	}

	async render( renderer, scene, camera ) {

		const target = this.renderTarget;
		target.setSize( renderer.domElement.width, renderer.domElement.height );

		this.swapMaterials( scene );

		const oldRenderTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( target );
		renderer.render( scene, camera );
		renderer.setRenderTarget( oldRenderTarget );

		this.restoreMaterials();

		// return the two textures
		return { albedo: target.textures[ 0 ], normal: target.textures[ 1 ] };

	}

	swapMaterials( object ) {

		if ( object instanceof THREE.Mesh && object.material ) {

			if ( ! this.originalMaterials.has( object ) )
				this.originalMaterials.set( object, object.material );

			if ( this.albedoMaterials.has( object ) ) {

				object.material = this.albedoMaterials.get( object );
				return;

			}

			const material = object.material;
			const newAlbedoMaterial = this.albedoNormalMaterial.clone();

			if ( material.color ) newAlbedoMaterial.uniforms.color.value.copy( material.color );
			newAlbedoMaterial.uniforms.diffuseMap.value = material.map;
			newAlbedoMaterial.uniforms.normalMap.value = material.normalMap;

			// Store normal map in userData if it exists
			if ( material.normalMap ) {

				object.userData.normalMap = material.normalMap;

			}

			if ( material.normalMap ) {

				newAlbedoMaterial.defines.USE_TANGENT = '';

			}

			this.albedoMaterials.set( object, newAlbedoMaterial );
			object.material = newAlbedoMaterial;

		}

		// biome-ignore lint/complexity/noForEach: <explanation>
		object.children.forEach( child => this.swapMaterials( child ) );

	}

	restoreMaterials() {

		this.originalMaterials.forEach( ( material, object ) => {

			if ( object instanceof THREE.Mesh ) {

				object.material = material;
				// Restore normal map from userData if it exists
				if ( object.userData.normalMap ) {

					object.material.normalMap = object.userData.normalMap;
					// biome-ignore lint/performance/noDelete: <explanation>
					delete object.userData.normalMap;

				}

			}

		} );
		this.originalMaterials.clear();

	}

	setUseWorldSpaceNormals( value ) {

		this._useWorldSpaceNormals = value;
		// biome-ignore lint/complexity/noForEach: <explanation>
		this.albedoMaterials.forEach( ( material ) => {

			if ( material instanceof THREE.ShaderMaterial ) {

				material.uniforms.useWorldSpaceNormals.value = value;

			}

		} );

	}

}
