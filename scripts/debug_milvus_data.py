import sys
import os
import random
from pymilvus import connections, Collection, utility

def debug_milvus():
    try:
        print("🔌 Connecting to Milvus...")
        connections.connect("default", host="localhost", port="19530")
        
        collection_name = "course_knowledge"
        if not utility.has_collection(collection_name):
            print(f"❌ Collection '{collection_name}' does not exist.")
            return

        collection = Collection(collection_name)
        collection.load()
        print(f"✅ Collection '{collection_name}' loaded.")
        print(f"📊 Total entities: {collection.num_entities}")

        # 1. Check Course Distribution (Sample)
        print("\n🔍 Sampling Data for Course Names:")
        # Milvus query to get some random entries
        # Note: query() limits are usually small, let's get 10 items
        results = collection.query(
            expr="pk > 0", 
            output_fields=["course_name", "source_info", "text"],
            limit=10
        )

        for res in results:
            c_name = res.get("course_name")
            s_info = res.get("source_info")
            text_preview = res.get("text")[:50] + "..."
            print(f"  - Course: [{c_name}] | File: {s_info} | Text: {text_preview}")

        # 2. Test Filtering Logic
        test_course = "材料力学"
        print(f"\n🧪 Testing Filter for Course: '{test_course}'")
        filter_expr = f'course_name == "{test_course}"'
        
        filter_results = collection.query(
            expr=filter_expr,
            output_fields=["course_name"],
            limit=5
        )
        
        if filter_results:
            print(f"  ✅ Found {len(filter_results)} items matching '{test_course}'.")
        else:
            print(f"  ⚠️ No items found for '{test_course}'. Check exact spelling.")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    debug_milvus()
