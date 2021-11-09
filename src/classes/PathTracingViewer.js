import { Scene, WebGLRenderer, MeshBasicMaterial } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/pass.js';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { PathTracingRenderer } from '../utils/PathTracingRenderer.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

export class PathTracingViewer {

    constructor() {

        this.scene = new Scene();
        this.renderer = new WebGLRenderer();
        this.fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
        this.ptRenderer = new PathTracingRenderer( this.renderer );
        this.ptModel = null;
        this.ptMaterials = null;
        this.model = null;
        this.bvhGenerator = new GenerateMeshBVHWorker();
        this._nextObject = null;

    }

    setSize( w, h ) {

        this.renderer.setSize( w, h );
        this.ptRenderer.setSize( w, h );

    }

    setModel( object ) {

        if ( this.bvhGenerator.running ) {

            this._nextObject = object;
            return;

        }

        object.updateMatrixWorld( true );

        const meshes = [];
        object.traverse( c => {

            if ( c.isMesh ) {

                meshes.push( c );

            }

        } );

        const { geometry, materials } = mergeMeshes( meshes, { attributes: [ 'normal', 'uv' ] } );
        return this
            .bvhGenerator
            .generate( geometry, { strategy: SAH, maxLeafTris: 1 } )
            .then( bvh => {

                if ( this._nextObject ) {

                    this.setModel( this._nextObject );
                    this._nextObject = null;
                    return;

                }

                if ( this.model ) {

                    this.scene.remove( this.model );

                }

                const mesh = new Mesh( geometry );
                this.scene.add( object );
                this.ptModel = mesh;
                this.ptMaterials = materials;
                this.model = object;

                const { ptRenderer } = this;
                ptRenderer.material.bvh.updateFrom( bvh );
                ptRenderer.material.normalAttribute.updateFrom( geometry.attributes.normal );
                ptRenderer.material.uvAttribute.updateFrom( geometry.attributes.uv );
                ptRenderer.material.materialDefineAttribute.updateFrom( geometry.attributes.materialIndex );

           } );

    }

    setEnvironment( envMap ) {

        this.scene.environment = envMap;

    }

    init() {

        const { ptRenderer, renderer, fsQuad } = this;

        const controls = new OrbitControls( this.renderer.domElement );
        controls.addEventListener( () => {

            ptRenderer.reset();

        } );

        renderer.setAnimationLoop( () => {

            if ( this.model ) {

                ptRenderer.material.setDefine( 'MATERIAL_LENGTH', this.materials.length );
                ptRenderer.material.materials.updateFrom( this.materials );
                ptRenderer.update();

                fsQuad.material.map = ptRenderer.target;
                fsQuad.render( renderer );

            } else {

                renderer.clear();

            }

        } );

    }

}
